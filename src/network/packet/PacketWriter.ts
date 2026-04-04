/**
 * PacketWriter - Queue and send binary packets to server
 *
 * Matches the reference client's PacketWriter/packetWriter pattern.
 * Packets are queued and flushed to the WebSocket as binary data.
 */
import { CLIENT_PACKET_LENGTHS, ClientPacketId } from "./ClientPacket";
import { PacketBuffer } from "./PacketBuffer";

/**
 * A node in the packet queue containing a packet buffer and its type
 * Matches reference client's PacketBufferNode
 *
 * Packet format: [opcode][length_prefix?][payload]
 * - Fixed: [opcode][payload] - length prefix omitted
 * - Variable byte (-1): [opcode][length_byte][payload]
 * - Variable short (-2): [opcode][length_hi][length_lo][payload]
 *
 * Efficiency: We reserve space after opcode for length prefix, write it
 * in-place during finalization. This avoids allocating new arrays.
 */
export class PacketBufferNode {
    packetType: ClientPacketId;
    packetBuffer: PacketBuffer;
    fixedLength: number;
    /** Finalized packet size in bytes (set when added to queue) */
    index: number = 0;
    /** Offset where payload data starts (after opcode + length prefix) */
    private payloadStart: number = 0;
    /** Whether this packet has been finalized */
    private finalized: boolean = false;
    /** Default payload capacity for variable-length packets */
    private readonly defaultBufferSize: number;

    constructor(packetType: ClientPacketId, bufferSize: number = 5000) {
        this.packetType = packetType;
        this.fixedLength = CLIENT_PACKET_LENGTHS[packetType] ?? -1;
        this.defaultBufferSize = bufferSize;

        // Calculate header size: 1 (opcode) + length prefix size
        const lengthPrefixSize = this.fixedLength === -2 ? 2 : this.fixedLength === -1 ? 1 : 0;
        const headerSize = 1 + lengthPrefixSize;
        const size = this.fixedLength >= 0 ? this.fixedLength + 1 : bufferSize;
        this.packetBuffer = new PacketBuffer(size + lengthPrefixSize);

        // Write opcode at position 0, reserve space for length prefix, payload follows
        this.packetBuffer.offset = 0;
        this.packetBuffer.writeByte(packetType);
        this.payloadStart = headerSize;
        this.packetBuffer.offset = headerSize; // Skip length prefix space
    }

    /**
     * Reset the node for reuse (pooling support)
     * Matches reference client's node reuse pattern
     */
    reset(packetType: ClientPacketId): void {
        this.packetType = packetType;
        this.fixedLength = CLIENT_PACKET_LENGTHS[packetType] ?? -1;
        this.index = 0;
        this.finalized = false;

        // Calculate header size
        const lengthPrefixSize = this.fixedLength === -2 ? 2 : this.fixedLength === -1 ? 1 : 0;
        const headerSize = 1 + lengthPrefixSize;
        this.payloadStart = headerSize;

        // Pool nodes are reused across packet types, so ensure capacity matches
        // the current packet before writing.
        const size =
            this.fixedLength >= 0 ? this.fixedLength + 1 : Math.max(1, this.defaultBufferSize | 0);
        const requiredCapacity = size + lengthPrefixSize;
        if (this.packetBuffer.length < requiredCapacity) {
            this.packetBuffer = new PacketBuffer(requiredCapacity);
        }

        // Write opcode, skip length prefix space
        this.packetBuffer.offset = 0;
        this.packetBuffer.writeByte(packetType);
        this.packetBuffer.offset = headerSize;
    }

    /**
     * Finalize the packet, writing length prefix in-place for variable packets.
     * Called by PacketWriter.addNode() before queueing.
     * Returns the total packet size including header.
     */
    finalize(): number {
        if (this.finalized) {
            return this.index;
        }

        if (this.fixedLength >= 0) {
            // Fixed length - total size is current offset (opcode + payload)
            this.index = this.packetBuffer.offset;
        } else {
            // Variable length - write length prefix after opcode
            const payloadLength = this.packetBuffer.offset - this.payloadStart;

            if (this.fixedLength === -2) {
                // 2-byte length prefix at positions 1-2 (after opcode)
                this.packetBuffer.data[1] = (payloadLength >> 8) & 0xff;
                this.packetBuffer.data[2] = payloadLength & 0xff;
            } else {
                // 1-byte length prefix at position 1 (after opcode)
                this.packetBuffer.data[1] = payloadLength & 0xff;
            }

            this.index = this.packetBuffer.offset; // Total size
        }

        this.finalized = true;
        return this.index;
    }

    /**
     * Get the finalized packet data as a view (no allocation)
     */
    toArray(): Uint8Array {
        if (!this.finalized) {
            this.finalize();
        }
        return this.packetBuffer.data.subarray(0, this.index);
    }

    /**
     * Write packet data directly into destination buffer
     * Returns number of bytes written
     */
    writeInto(dest: Uint8Array, destOffset: number): number {
        if (!this.finalized) {
            this.finalize();
        }
        dest.set(this.packetBuffer.data.subarray(0, this.index), destOffset);
        return this.index;
    }
}

/**
 * Pool for reusing PacketBufferNode instances
 * Matches reference client's node pooling to reduce GC pressure
 */
class PacketBufferNodePool {
    private pool: PacketBufferNode[] = [];
    private readonly maxSize = 32;

    acquire(packetType: ClientPacketId): PacketBufferNode {
        const node = this.pool.pop();
        if (node) {
            node.reset(packetType);
            return node;
        }
        return new PacketBufferNode(packetType);
    }

    release(node: PacketBufferNode): void {
        if (this.pool.length < this.maxSize) {
            node.packetBuffer.releaseArray();
            this.pool.push(node);
        }
    }

    clear(): void {
        this.pool.length = 0;
    }
}

/**
 * Packet writer that queues and sends packets
 *
 * Matches the reference client's PacketWriter implementation:
 * - Pre-allocated 5000 byte buffer for batching
 * - Tracks bufferSize as packets are added
 * - Handles buffer overflow (sends partial batch if needed)
 * - Object pooling for PacketBufferNodes
 */
export class PacketWriter {
    /** Packet node queue (deque in reference, array here) */
    private packetBufferNodes: PacketBufferNode[] = [];
    /** Total size of all queued packet data */
    private bufferSize: number = 0;
    /** Pre-allocated buffer for batching packets (5000 bytes like reference) */
    private readonly buffer: Uint8Array = new Uint8Array(5000);
    /** Current write offset in the buffer */
    private bufferOffset: number = 0;
    /** WebSocket connection */
    private socket: WebSocket | null = null;
    /** ISAAC cipher for opcode encryption */
    private isaacCipher: IsaacCipher | null = null;
    /** Pending write count (for tracking) */
    private pendingWrites: number = 0;
    /** Node pool for reuse */
    private readonly nodePool = new PacketBufferNodePool();

    /**
     * Set the WebSocket connection
     */
    setSocket(socket: WebSocket | null): void {
        this.socket = socket;
        if (socket) {
            socket.binaryType = "arraybuffer";
        }
    }

    /**
     * Set the ISAAC cipher for packet encryption (optional)
     */
    setIsaacCipher(cipher: IsaacCipher | null): void {
        this.isaacCipher = cipher;
    }

    /**
     * Create a new packet buffer node for the given packet type
     * Uses object pooling to reduce allocations
     */
    createPacket(packetType: ClientPacketId): PacketBufferNode {
        return this.nodePool.acquire(packetType);
    }

    /**
     * Add a packet to the send queue
     * Matches reference: addNode(PacketBufferNode)
     */
    addNode(node: PacketBufferNode): void {
        // Finalize the packet (writes length prefix in-place for variable packets)
        const size = node.finalize();
        this.packetBufferNodes.push(node);
        this.bufferSize += size;
    }

    /**
     * Clear the buffer without sending
     * Matches reference: clearBuffer()
     */
    clearBuffer(): void {
        for (const node of this.packetBufferNodes) {
            this.nodePool.release(node);
        }
        this.packetBufferNodes.length = 0;
        this.bufferSize = 0;
    }

    /**
     * Flush all queued packets to the socket
     *
     * Matches reference client's flush() exactly:
     * - Uses pre-allocated buffer
     * - Copies packets into buffer until full
     * - Sends when buffer would overflow or queue is empty
     * - Releases nodes back to pool
     *
     * Optimizations:
     * - Uses writeInto() for zero-copy batching
     * - Sends a copied batch buffer slice to avoid mutable-view races
     * - ISAAC encryption applied in batch buffer
     */
    flush(): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN || this.bufferSize === 0) {
            this.clearBuffer();
            return;
        }

        this.bufferOffset = 0;

        // Process packets from end of queue (like reference's last())
        while (this.packetBufferNodes.length > 0) {
            const node = this.packetBufferNodes[this.packetBufferNodes.length - 1];
            const packetSize = node.index;

            // Check if packet fits in remaining buffer space
            if (packetSize > this.buffer.length - this.bufferOffset) {
                // Buffer would overflow - send what we have first
                if (this.bufferOffset > 0) {
                    // Send a copy, not a mutable view of the shared batch buffer.
                    // Some runtimes can defer internal copying after send(), so reusing
                    // the same backing array may corrupt in-flight packet bytes.
                    this.socket.send(this.buffer.slice(0, this.bufferOffset));
                    this.pendingWrites = 0;
                    this.bufferOffset = 0;
                }

                // If single packet is larger than buffer, send directly
                if (packetSize > this.buffer.length) {
                    const packetData = node.toArray();
                    if (this.isaacCipher) {
                        packetData[0] = (packetData[0] + this.isaacCipher.nextInt()) & 0xff;
                    }
                    this.socket.send(packetData);
                    this.bufferSize -= packetSize;
                    this.packetBufferNodes.pop();
                    this.nodePool.release(node);
                    continue;
                }
            }

            // Copy packet directly into batch buffer (efficient - no intermediate array)
            const opcodeOffset = this.bufferOffset;
            node.writeInto(this.buffer, this.bufferOffset);

            // Apply ISAAC encryption to opcode in the batch buffer
            if (this.isaacCipher) {
                this.buffer[opcodeOffset] =
                    (this.buffer[opcodeOffset] + this.isaacCipher.nextInt()) & 0xff;
            }

            this.bufferOffset += packetSize;
            this.bufferSize -= packetSize;

            // Remove and release node
            this.packetBufferNodes.pop();
            this.nodePool.release(node);
        }

        // Send any remaining data in buffer
        if (this.bufferOffset > 0) {
            // Send a copy, not a mutable view of the shared batch buffer.
            this.socket.send(this.buffer.slice(0, this.bufferOffset));
            this.pendingWrites = 0;
        }

        this.bufferOffset = 0;
    }

    /**
     * Send a single packet immediately (bypasses queue)
     */
    sendImmediate(node: PacketBufferNode): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }

        const data = node.toArray();

        if (this.isaacCipher) {
            data[0] = (data[0] + this.isaacCipher.nextInt()) & 0xff;
        }

        this.socket.send(data);
        this.nodePool.release(node);
    }

    /**
     * Check if socket is connected and ready
     */
    isConnected(): boolean {
        return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
    }

    /**
     * Get number of packets in queue
     */
    get queueSize(): number {
        return this.packetBufferNodes.length;
    }

    /**
     * Get total queued data size in bytes
     */
    getBufferSize(): number {
        return this.bufferSize;
    }

    /**
     * Clear the packet queue without sending
     */
    clearQueue(): void {
        this.clearBuffer();
    }
}

/**
 * ISAAC cipher for packet encryption
 * Matches the reference client's IsaacCipher
 */
export class IsaacCipher {
    private count: number = 0;
    private readonly results: Int32Array = new Int32Array(256);
    private readonly memory: Int32Array = new Int32Array(256);
    private accumulator: number = 0;
    private lastResult: number = 0;
    private counter: number = 0;

    constructor(seed?: number[]) {
        if (seed) {
            this.init(seed);
        }
    }

    /**
     * Initialize the cipher with a seed
     */
    init(seed: number[]): void {
        for (let i = 0; i < seed.length; i++) {
            this.results[i] = seed[i];
        }
        this.initInternal();
    }

    private initInternal(): void {
        let a = 0x9e3779b9;
        let b = 0x9e3779b9;
        let c = 0x9e3779b9;
        let d = 0x9e3779b9;
        let e = 0x9e3779b9;
        let f = 0x9e3779b9;
        let g = 0x9e3779b9;
        let h = 0x9e3779b9;

        for (let i = 0; i < 4; i++) {
            a ^= b << 11;
            d = (d + a) | 0;
            b = (b + c) | 0;
            b ^= c >>> 2;
            e = (e + b) | 0;
            c = (c + d) | 0;
            c ^= d << 8;
            f = (f + c) | 0;
            d = (d + e) | 0;
            d ^= e >>> 16;
            g = (g + d) | 0;
            e = (e + f) | 0;
            e ^= f << 10;
            h = (h + e) | 0;
            f = (f + g) | 0;
            f ^= g >>> 4;
            a = (a + f) | 0;
            g = (g + h) | 0;
            g ^= h << 8;
            b = (b + g) | 0;
            h = (h + a) | 0;
            h ^= a >>> 9;
            c = (c + h) | 0;
            a = (a + b) | 0;
        }

        for (let i = 0; i < 256; i += 8) {
            a = (a + this.results[i]) | 0;
            b = (b + this.results[i + 1]) | 0;
            c = (c + this.results[i + 2]) | 0;
            d = (d + this.results[i + 3]) | 0;
            e = (e + this.results[i + 4]) | 0;
            f = (f + this.results[i + 5]) | 0;
            g = (g + this.results[i + 6]) | 0;
            h = (h + this.results[i + 7]) | 0;

            a ^= b << 11;
            d = (d + a) | 0;
            b = (b + c) | 0;
            b ^= c >>> 2;
            e = (e + b) | 0;
            c = (c + d) | 0;
            c ^= d << 8;
            f = (f + c) | 0;
            d = (d + e) | 0;
            d ^= e >>> 16;
            g = (g + d) | 0;
            e = (e + f) | 0;
            e ^= f << 10;
            h = (h + e) | 0;
            f = (f + g) | 0;
            f ^= g >>> 4;
            a = (a + f) | 0;
            g = (g + h) | 0;
            g ^= h << 8;
            b = (b + g) | 0;
            h = (h + a) | 0;
            h ^= a >>> 9;
            c = (c + h) | 0;
            a = (a + b) | 0;

            this.memory[i] = a;
            this.memory[i + 1] = b;
            this.memory[i + 2] = c;
            this.memory[i + 3] = d;
            this.memory[i + 4] = e;
            this.memory[i + 5] = f;
            this.memory[i + 6] = g;
            this.memory[i + 7] = h;
        }

        for (let i = 0; i < 256; i += 8) {
            a = (a + this.memory[i]) | 0;
            b = (b + this.memory[i + 1]) | 0;
            c = (c + this.memory[i + 2]) | 0;
            d = (d + this.memory[i + 3]) | 0;
            e = (e + this.memory[i + 4]) | 0;
            f = (f + this.memory[i + 5]) | 0;
            g = (g + this.memory[i + 6]) | 0;
            h = (h + this.memory[i + 7]) | 0;

            a ^= b << 11;
            d = (d + a) | 0;
            b = (b + c) | 0;
            b ^= c >>> 2;
            e = (e + b) | 0;
            c = (c + d) | 0;
            c ^= d << 8;
            f = (f + c) | 0;
            d = (d + e) | 0;
            d ^= e >>> 16;
            g = (g + d) | 0;
            e = (e + f) | 0;
            e ^= f << 10;
            h = (h + e) | 0;
            f = (f + g) | 0;
            f ^= g >>> 4;
            a = (a + f) | 0;
            g = (g + h) | 0;
            g ^= h << 8;
            b = (b + g) | 0;
            h = (h + a) | 0;
            h ^= a >>> 9;
            c = (c + h) | 0;
            a = (a + b) | 0;

            this.memory[i] = a;
            this.memory[i + 1] = b;
            this.memory[i + 2] = c;
            this.memory[i + 3] = d;
            this.memory[i + 4] = e;
            this.memory[i + 5] = f;
            this.memory[i + 6] = g;
            this.memory[i + 7] = h;
        }

        this.isaac();
        this.count = 256;
    }

    private isaac(): void {
        this.counter++;
        this.lastResult = (this.lastResult + this.counter) | 0;

        for (let i = 0; i < 256; i++) {
            const x = this.memory[i];
            switch (i & 3) {
                case 0:
                    this.accumulator ^= this.accumulator << 13;
                    break;
                case 1:
                    this.accumulator ^= this.accumulator >>> 6;
                    break;
                case 2:
                    this.accumulator ^= this.accumulator << 2;
                    break;
                case 3:
                    this.accumulator ^= this.accumulator >>> 16;
                    break;
            }
            this.accumulator = (this.memory[(i + 128) & 255] + this.accumulator) | 0;
            const y = (this.memory[(x >>> 2) & 255] + this.accumulator + this.lastResult) | 0;
            this.memory[i] = y;
            this.lastResult = (this.memory[(y >>> 10) & 255] + x) | 0;
            this.results[i] = this.lastResult;
        }
    }

    /**
     * Get the next random integer from the cipher
     */
    nextInt(): number {
        if (this.count-- === 0) {
            this.isaac();
            this.count = 255;
        }
        return this.results[this.count];
    }
}

// Singleton instance
let packetWriterInstance: PacketWriter | null = null;

/**
 * Get the global packet writer instance
 */
export function getPacketWriter(): PacketWriter {
    if (!packetWriterInstance) {
        packetWriterInstance = new PacketWriter();
    }
    return packetWriterInstance;
}

/**
 * Convenience function to create and queue a packet
 */
export function createPacket(packetType: ClientPacketId): PacketBufferNode {
    return getPacketWriter().createPacket(packetType);
}

/**
 * Convenience function to add a packet to the queue
 */
export function queuePacket(node: PacketBufferNode): void {
    getPacketWriter().addNode(node);
}

/**
 * Convenience function to flush all queued packets
 */
export function flushPackets(): void {
    getPacketWriter().flush();
}

/**
 * Set the WebSocket for binary packet sending
 */
export function setPacketSocket(socket: WebSocket | null): void {
    getPacketWriter().setSocket(socket);
}
