// Loose ends: things you came across in a zone but did not finish. Built only
// from what you saw, so it needs no quest database: quests offered, accepted
// or abandoned but never turned in; creatures met but never killed; shops
// and trainers seen but never opened; rares you saw once.

const SHOP_TITLE = /supplies|vendor|merchant|goods|armorer|weaponsmith|blacksmith|tailor|leatherwork|innkeeper|reagent|trade|fletcher|bowyer|gunsmith|alchemist|cook|baker|butcher|fish|poison|bag|clothier|smith|jeweler|engineer|enchant|stable|apothecary|food|drink/i;
const TRAINER_TITLE = /trainer|instructor|teacher/i;

export function looseEnds(zoneName, codex, world) {
  const quests = codex.quests.filter((q) => q.zone === zoneName && q.status !== 'done');
  const creatures = world.creatures.filter((n) => n.zones.includes(zoneName) && n.kills === 0);
  const shops = world.people.filter((n) => n.zones.includes(zoneName) && !n.vendor && n.titles.some((t) => SHOP_TITLE.test(t)));
  const trainers = world.people.filter((n) => n.zones.includes(zoneName) && !n.trainer && n.titles.some((t) => TRAINER_TITLE.test(t)));
  const rares = creatures.filter((n) => n.rare || n.ranks.some((r) => r.includes('rare') || r === 'worldboss'));
  return {
    quests: quests.sort((a, b) => (a.status === 'active' ? -1 : 1) - (b.status === 'active' ? -1 : 1)),
    creatures: creatures.sort((a, b) => b.sightings - a.sightings),
    rares,
    shops,
    trainers,
    total: quests.length + creatures.length + shops.length + trainers.length,
  };
}
