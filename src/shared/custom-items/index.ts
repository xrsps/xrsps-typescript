/**
 * Custom Items Registration (Shared)
 *
 * Imported by both client and server to register custom items on both sides.
 */
import { CustomItemRegistry } from "../../custom/items/CustomItemRegistry";
// Import and register all custom items
import "./customItems";

console.log(`[CustomItems] Registered ${CustomItemRegistry.getCount()} custom item(s)`);

// Re-export item IDs for convenience
export { CUSTOM_ITEM_IDS } from "./customItems";
