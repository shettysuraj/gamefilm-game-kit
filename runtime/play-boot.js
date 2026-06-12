// Boots the real GameFilm runtime with your game for local play.
// No hub, no token, no submission — just play and feel it. The runtime picks a random seed each
// run (great for testing); `gf verify` is what checks determinism across seeds.
import { boot } from '/runtime/gamefilm-runtime.js';
boot('local');
