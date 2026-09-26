-- Loaded before Compendium.lua. If /comp only ever prints the message below,
-- WoW found the addon but Compendium.lua failed while loading; if /comp does
-- nothing at all, WoW did not load the addon.

COMPENDIUM_BOOTED = true

SLASH_COMPENDIUM1 = "/comp"
SLASH_COMPENDIUM2 = "/compendium"
SlashCmdList.COMPENDIUM = function()
	print("|cff5a9bffCompendium|r is installed but its main file failed to load. Type |cffffffff/console scriptErrors 1|r then |cffffffff/reload|r to see the error, and send it over.")
end
