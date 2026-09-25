-- Loaded before Chronicler.lua. If /chron only ever prints the message below,
-- WoW found the addon but Chronicler.lua failed while loading; if /chron does
-- nothing at all, WoW did not load the addon.

CHRONICLER_BOOTED = true

SLASH_CHRONICLER1 = "/chron"
SLASH_CHRONICLER2 = "/chronicler"
SlashCmdList.CHRONICLER = function()
	print("|cffd4a017Chronicler|r is installed but its main file failed to load. Type |cffffffff/console scriptErrors 1|r then |cffffffff/reload|r to see the error, and send it over.")
end
