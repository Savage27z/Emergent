// Standalone smoke test: node agents/demo.js
// Exercises the memory stream with no game server involved.
const { MemoryStream } = require('./memory');

const mem = new MemoryStream(':memory:');
mem.observe('npc-test', 'the sun rose over the village', { importance: 1 });
mem.observe('npc-test', 'savage arrived at the campfire', { importance: 3 });
mem.observe('npc-test', 'I started fishing at the lake', { importance: 4 });

console.log('count:', mem.count('npc-test'));
console.log('recent:');
for (const m of mem.recent('npc-test')) console.log(' ', m.kind, '|', m.text, `(imp ${m.importance})`);
console.log('retrieved (recency+importance):');
for (const m of mem.retrieve('npc-test', 2)) console.log(' ', m.text, `(score ${m.score.toFixed(2)})`);
