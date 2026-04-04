Two kinds of components that will be used to expand XRSPS in content as it grows:

1) Gamemodes: servers will run a gamemode which will be the “heart” of the server. For example a leagues server would have a “league.ts” gamemode in a folder alongside other scripts inside it which is required
2) Extrascripts: these will work independently of which gamemode is running. A good example is default osrs skill functionality like cooking.ts

The client and server should be agnostic - eg. not depend on a gamemode and have the gamemode have central functionality insnide the corresponding gamemode folder.
The ideal long term point of this is to create a scripter ecosystem and leave the systems untouched (client/server) to make them become more stable.