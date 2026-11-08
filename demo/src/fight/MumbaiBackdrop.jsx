import { memo } from "react";

// Pixel art uses integer scene coordinates. Scenery ends at the mat (y=48);
// posts, ropes, health bars and captions belong to FightStage.
const P = ({ x, y, w = 1, h = 1, fill, opacity }) => <rect x={x} y={y} width={w} height={h} fill={fill} opacity={opacity} />;
const Block = ({ x, y, w, h, fill, windows = "#ffe8b0" }) => (
  <g>
    <P x={x} y={y} w={w} h={h} fill={fill} />
    {Array.from({ length: Math.floor((w - 2) / 3) }, (_, c) =>
      Array.from({ length: Math.floor((h - 2) / 4) }, (_, r) => <P key={`${c}-${r}`} x={x + 1 + c * 3} y={y + 2 + r * 4} fill={windows} opacity={0.7} />),
    )}
  </g>
);

function Sun({ x, y, color = "#ffd77d", r = 6 }) {
  return <g>{Array.from({ length: r * 2 }, (_, row) => {
    const half = Math.round(Math.sqrt(r ** 2 - (row - r + 0.5) ** 2));
    return <P key={row} x={x - half} y={y - r + row} w={half * 2} fill={color} />;
  })}</g>;
}

function Water({ y = 33, color, glint }) {
  return <g>
    <P x={0} y={y} w={108} h={48 - y} fill={color} />
    {Array.from({ length: 29 }, (_, i) => <P key={i} x={(i * 29) % 104} y={y + 2 + (i * 7) % Math.max(1, 46 - y)} w={2 + i % 5} fill={glint} opacity={i % 3 === 0 ? 0.6 : 0.25} />)}
  </g>;
}

function Palm({ x, y, color = "#346c68", flip = false }) {
  return <g transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1)`} fill={color}>
    <path d="M0 1h2v6h1v8h2v10H2V16H1V8H0z" />
    <path d="M0 1h-3v-2h-5v1h-3v2h-2v2h2V3h4V2h7zM1 1h3v-2h5v1h3v2h2v2h-2V3H8V2H1zM0 0v-4h-2v-2h-3v1h2v2h1v3zM2 0v-4h2v-2h3v1H5v2H4v3z" />
  </g>;
}

function Boat({ x, y, color = "#faf0d7" }) {
  return <g transform={`translate(${x} ${y})`}>
    <P x={3} y={-3} w={1} h={4} fill="#435d71" />
    <path d="M4-3h1v1h1v1h1v1H4z" fill={color} />
    <path d="M0 1h9v1H8v1H2V2H1z" fill={color} />
  </g>;
}

function Gateway() {
  return <g>
    <P x={0} y={0} w={108} h={48} fill="#f8dcc2" />
    <P x={0} y={22} w={108} h={12} fill="#efc49f" />
    <Sun x={86} y={16} />
    <P x={3} y={11} w={17} fill="#fff1d8" /><P x={7} y={10} w={10} fill="#fff1d8" />
    <P x={65} y={7} w={24} fill="#fff1d8" /><P x={70} y={6} w={12} fill="#fff1d8" />
    <Water color="#83babb" glint="#e7f3da" />
    {/* Apollo Bunder: four turrets, pointed centre arch, sandstone courses. */}
    <g fill="#bc855b">
      <P x={12} y={19} w={27} h={17} fill="#c99461" />
      <P x={10} y={35} w={31} h={2} fill="#b7825a" />
      <P x={11} y={23} w={29} h={2} fill="#f1ce95" />
      <P x={19} y={17} w={13} h={6} fill="#d3a16c" />
      <P x={18} y={16} w={15} h={2} fill="#f1ce95" />
      {[12, 19, 30, 37].map((x) => <g key={x}>
        <P x={x} y={16} w={2} h={9} fill="#dfb47c" />
        <P x={x - 1} y={15} w={4} fill="#bf8b5f" />
        <P x={x} y={13} w={2} h={2} fill="#bf8b5f" />
      </g>)}
      <path d="M21 36V29h1v-2h2v-1h3v1h2v2h1v7z" fill="#759b9d" />
      <path d="M23 36v-7h1v-1h3v1h1v7z" fill="#8dc3c1" />
      <P x={14} y={27} w={3} h={5} fill="#986d54" /><P x={34} y={27} w={3} h={5} fill="#986d54" />
      <P x={12} y={33} w={7} fill="#e7ba83" /><P x={32} y={33} w={7} fill="#e7ba83" />
    </g>
    {/* Taj Palace: red dome and alternating cream arches. */}
    <Block x={75} y={23} w={31} h={12} fill="#d09b87" windows="#fff0cf" />
    <P x={74} y={22} w={33} h={2} fill="#8c6769" />
    <P x={83} y={18} w={12} h={17} fill="#e7ba98" />
    <path d="M82 18h14v-2h-1v-2h-2v-2h-2v-1h-4v1h-2v2h-2v2h-1z" fill="#b75d64" />
    <P x={88} y={8} w={2} h={4} fill="#b75d64" />
    {[79, 86, 90, 98, 103].map((x) => <P key={x} x={x} y={27} w={2} h={4} fill="#927474" />)}
    <P x={75} y={33} w={31} h={2} fill="#f3d3ae" />
    <Boat x={46} y={38} /><Boat x={65} y={34} color="#ebca98" />
    <P x={0} y={45} w={108} h={3} fill="#d2a77c" />
    <P x={0} y={45} w={108} fill="#f5d3aa" />
    <Palm x={1} y={26} color="#688c78" />
  </g>;
}

function MarineDrive() {
  return <g>
    <P x={0} y={0} w={108} h={48} fill="#454767" />
    <P x={0} y={17} w={108} h={15} fill="#797497" />
    <P x={0} y={27} w={108} h={8} fill="#b18b9b" />
    <Sun x={89} y={17} color="#fff0b4" r={3} />
    {[[7, 9], [20, 13], [68, 10], [100, 6], [78, 15]].map(([x, y]) => <P key={x} x={x} y={y} fill="#f7e2b8" />)}
    {[[0, 19, 8, 14], [8, 23, 7, 10], [15, 16, 7, 17], [22, 21, 10, 12], [32, 24, 7, 10], [40, 26, 6, 8], [50, 28, 5, 6]].map(([x, y, w, h]) => <Block key={x} x={x} y={y} w={w} h={h} fill="#5d617e" windows="#f5c984" />)}
    <P x={18} y={12} w={1} h={5} fill="#5d617e" />
    <Water y={34} color="#505b7e" glint="#eeb1b5" />
    {/* The stepped promenade and lamps form the Queen's Necklace. */}
    <path d="M0 31h18v1h11v1h10v1h9v1h10v1h9v1h9v1h8v1h7v2h7v2h10v5H0z" fill="#9c91a3" />
    <path d="M0 34h17v1h12v1h10v1h9v1h10v1h9v1h9v1h8v2h7v2h7v3H0z" fill="#53516d" />
    {[[3, 30], [12, 30], [22, 31], [32, 32], [42, 33], [52, 34], [62, 35], [73, 36], [83, 38], [93, 41], [104, 44]].map(([x, y]) => <g key={x}>
      <P x={x} y={y - 2} w={1} h={4} fill="#444961" />
      <P x={x - 1} y={y - 3} w={3} h={2} fill="#ffe2a1" />
      <P x={x} y={y + 3} w={2} h={2} fill="#f8bb8f" opacity={0.4} />
    </g>)}
    <Palm x={5} y={22} color="#373d5a" /><Palm x={103} y={28} color="#373d5a" flip />
  </g>;
}

/** Stair-stepped cables, so bridge diagonals share the pixel grid. */
function Cable({ x1, y1, x2, y2, color }) {
  const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  return <g>{Array.from({ length: n + 1 }, (_, i) => <P key={i} x={Math.round(x1 + (x2 - x1) * i / n)} y={Math.round(y1 + (y2 - y1) * i / n)} fill={color} />)}</g>;
}

function SeaLink() {
  return <g>
    <P x={0} y={0} w={108} h={48} fill="#c4e0d4" />
    <P x={0} y={22} w={108} h={11} fill="#f3cfab" />
    <Sun x={75} y={21} color="#ffb66c" r={7} />
    <P x={5} y={11} w={20} fill="#eef0d7" /><P x={9} y={10} w={9} fill="#eef0d7" />
    <P x={84} y={8} w={20} fill="#eef0d7" />
    <Water y={33} color="#6ea7aa" glint="#d5e3c8" />
    {[[2, 25, 8], [9, 23, 6], [16, 26, 8], [90, 24, 6], [97, 20, 8]].map(([x, y, w]) => <P key={x} x={x} y={y} w={w} h={33 - y} fill="#9db9b0" />)}
    {[29, 80].map((x) => <g key={x}>
      {[-25, -19, -13, -7, 7, 13, 19, 25].map((d) => <Cable key={d} x1={x} y1={17} x2={x + d} y2={31} color="#f8edce" />)}
      <P x={x - 2} y={15} w={5} h={2} fill="#507f87" />
      <P x={x - 2} y={17} w={2} h={20} fill="#507f87" />
      <P x={x + 1} y={17} w={2} h={20} fill="#507f87" />
      <P x={x - 2} y={23} w={5} h={2} fill="#507f87" />
      <P x={x - 3} y={36} w={7} h={2} fill="#507f87" />
    </g>)}
    <P x={0} y={31} w={108} h={2} fill="#486e7b" />
    <P x={0} y={30} w={108} fill="#f1e0bc" />
    {[8, 17, 45, 67, 95].map((x, i) => <P key={x} x={x} y={29} w={3} fill={i % 2 ? "#f2c052" : "#f9efd5"} />)}
    <Boat x={55} y={40} />
    <path d="M0 43h8v1h10v2h7v2H0zM108 42h-7v2h-8v2h-5v2h20z" fill="#6c9186" />
    <Palm x={3} y={25} /><Palm x={105} y={26} flip />
  </g>;
}

function LocalTrain() {
  return <g>
    <P x={0} y={0} w={108} h={48} fill="#f5d7c6" />
    <P x={0} y={23} w={108} h={15} fill="#e4b5a7" />
    <P x={8} y={11} w={18} fill="#fff0dc" /><P x={87} y={15} w={15} fill="#fff0dc" />
    {/* CSMT's domed clock tower and Gothic wings, behind the local. */}
    <Block x={3} y={24} w={102} h={11} fill="#b5866e" windows="#e9c6a0" />
    {[6, 15, 24, 35, 45, 58, 69, 83, 95].map((x) => <g key={x}>
      <P x={x} y={22} w={6} h={2} fill="#986e62" />
      <P x={x + 1} y={21} w={4} fill="#986e62" />
      <P x={x + 2} y={20} w={2} fill="#986e62" />
    </g>)}
    <P x={74} y={17} w={12} h={18} fill="#d1a17a" />
    <path d="M72 17h16v-2h-2v-2h-2v-2h-2V9h-4v2h-2v2h-2v2h-2z" fill="#9b6f67" />
    <P x={79} y={6} w={2} h={4} fill="#9b6f67" />
    <P x={77} y={19} w={6} h={6} fill="#fbe8bd" />
    <P x={79} y={20} w={1} h={3} fill="#866966" /><P x={80} y={22} w={2} fill="#866966" />
    {[8, 24, 40, 59, 92].map((x) => <g key={x}>
      <P x={x} y={28} w={4} h={6} fill="#7c6865" /><P x={x + 1} y={27} w={2} fill="#7c6865" />
    </g>)}
    <P x={0} y={38} w={108} h={10} fill="#bc9a91" />
    <P x={0} y={42} w={108} h={2} fill="#685b6d" />
    {Array.from({ length: 20 }, (_, i) => <P key={i} x={i * 6} y={44} w={3} fill="#d9bbae" />)}
    {/* The unmistakable cream-and-purple Mumbai local. */}
    <P x={5} y={32} w={98} h={8} fill="#f9edce" />
    <P x={7} y={31} w={94} fill="#8f7190" />
    <P x={5} y={38} w={98} h={3} fill="#946b98" />
    {[8, 15, 31, 38, 54, 61, 77, 84, 96].map((x) => <P key={x} x={x} y={34} w={4} h={3} fill="#58868e" />)}
    {[23, 46, 69, 91].map((x) => <g key={x}>
      <P x={x} y={33} w={4} h={7} fill="#7d7083" /><P x={x + 1} y={34} w={2} h={3} fill="#c5d6cf" />
      <P x={x - 6} y={41} w={3} fill="#49475a" />
    </g>)}
    <P x={0} y={28} w={108} fill="#8b737c" />
    <P x={2} y={26} w={1} h={16} fill="#8b737c" /><P x={105} y={26} w={1} h={16} fill="#8b737c" />
  </g>;
}

const SCENES = { gateway: Gateway, marine: MarineDrive, "sea-link": SeaLink, local: LocalTrain };
export const MumbaiBackdrop = memo(function MumbaiBackdrop({ scene = "gateway" }) {
  const Scene = SCENES[scene] ?? Gateway;
  return <g data-scenery={scene}><Scene /></g>;
});
