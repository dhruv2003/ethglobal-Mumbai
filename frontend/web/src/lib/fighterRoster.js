/*
 * Original 16×20 pixel interpretations of Mumbai street life and cult comedy.
 * F/f = costume, T/t = accent, L/l = light/metal; J/j keeps sponsor trim.
 * All faces share the eye anchors at (5,5) and (9,5), so existing earned
 * accessories and blink animation work across the entire cast.
 */
const palette = (F, f, T, t = "#bf6728") => ({ F, f, T, t, L: "#fff3d6", l: "#b8cad1", N: "#283147" });

export const FIGHTER_ROSTER = [
  {
    id: "vada-pav", name: "Vada Pav Pehelwan", detail: "Extra chutney. Extra attitude.",
    palette: palette("#ecaa50", "#ba6836", "#51a64b", "#27764c"),
    rows: [
      ".....OOOOOO.....", "...OOFFFFFFOO...", "..OFFLFFFLFFFO..", ".OFFFLFFFFFFLFO.",
      ".OFFFFFFFFFFFFO.", ".OFFFFFFFFFFFFO.", ".OffFFFFFFFFffO.", ".OffFFFMFFFFffO.",
      ".OTTTTTTTTTTTTO.", ".OtFtFFtFFFtFTO.", "..OFFffffffFFO..", "...OOOOOOOOOO...",
      ".OSSOJJJJJJOOSO.", ".OSSOJJJJJJOOSO.", ".OOO.OJJJJO.OOO.", ".....OPPPPO.....",
      "....OPPOOPPO....", "....OPPOOPPO....", "...OBBBOOBBBO...", "...OOOOOOOOOO...",
    ],
  },
  {
    id: "babu-bhaiya", name: "Babu Bhaiya", detail: "Hera Pheri · spectacles & slippers",
    palette: palette("#fff5da", "#c4bc9d", "#7ab2b6"), hair: "#4a3a31",
    rows: [
      ".....OOOOOO.....", "...OOSSSSSSOO...", "..OHSSSSSSSSHO..", "..OHSSSSSSSSHO..",
      "..OOOOOOOOOOOO..", "..OOSSSOOSSSOO..", "..OOSSSOOSSSOO..", "..OSOOOSSOOOSO..",
      "...OSSSMMSSSO...", "....OSSSSSSO....", "...OSFSSSSFSO...", "..OSFFSSSSFFSO..",
      ".OSSOFFFFFFOSSO.", ".OSSOFFFFFFOSSO.", ".OOOOSSSSSSOOOO.", "....OJJJJJJO....",
      "....OFFfFFFO....", "....OFlOfFFO....", "....OSSOOSSO....", "...OOOOOOOOOO...",
    ],
  },
  {
    id: "cutting-chai", name: "Cutting Chai Champ", detail: "Small glass. Full power.",
    palette: palette("#b5e4dd", "#70b7b0", "#bc713e", "#965032"),
    rows: [
      "....L...L.......", ".....L...L......", "....L...L.......", "..OOOOOOOOOO....",
      "..OLTTTTTTLOOO..", "..OLTTTTTTLO.LO.", "..OLTTTTTTLO.LO.", "..OLTTTMTTLO.LO.",
      "...OFTTTTFOOOO..", "...OFLFFLFO.....", "....OFFFFO......", "....OOOOOO......",
      "..OJJOJJJJOJJO..", "..OSSOJJJJOSSO..", "..OOOOjjjjOOOO..", ".....OPPPPO.....",
      ".....OPPPPO.....", ".....OPOOPO.....", "....OBBOOBBO....", "....OOOOOOOO....",
    ],
  },
  {
    id: "circuit", name: "Circuit", detail: "Munna Bhai · gold-chain energy",
    palette: palette("#303343", "#20212f", "#e4b54d"), hair: "#29212a",
    rows: [
      "....OOOOOOO.....", "...OHHHHHHHOO...", "..OHHHHHHHHHHO..", "..OHHHHHHHHHHO..",
      "..OHSSSSSSSSHO..", "..OSSSSSSSSSSO..", "..OSSSSSSSSSSO..", "..OsSSSMMSSSsO..",
      "...OSSSSSSSSO...", "....OSSSSSSO....", "...OFSTSSTSFO...", "..OFFSTTSSTFFO..",
      ".OFFOFFTTFFOFFO.", ".OFFOFFFFFFOFFO.", ".OSSOFFJJFFOSSO.", ".OOO.OFFFFO.OOO.",
      "....OJNNOJJO....", "....OJNNOJJO....", "....ONNOONNO....", "...OOOOOOOOOO...",
    ],
  },
  {
    id: "majnu-bhai", name: "Majnu Bhai", detail: "Welcome · artist in the arena",
    palette: palette("#f3c251", "#d49036", "#ed6e8b"), hair: "#342632",
    rows: [
      "...OOOOOOOO.....", "..OHHHHHHHHOO...", "..OHHHHHHHHHHO..", "..OHHHSSSSSSHO..",
      "..OHSSSSSSSSHO..", "..OSSSSSSSSSSO..", "..OSSSSSSSSSSO..", "..OSSOOOOOSSSO..",
      "...OSSOMOSSSO...", "....OSSSSSSO....", "...OFFSSSSFFO...", "..OFFFTFFTFFFO..",
      ".OSSOFFFFFFFFO..", ".OSSOFTFFTFFSO..", ".OOO.OJJJJO.OO..", ".....OFFFFO.....",
      ".....OPPPPO.....", ".....OPOOPO.....", "....OBBOOBBO....", "....OOOOOOOO....",
    ],
    prop: [[14, 8, "T"], [15, 8, "T"], [14, 9, "L"], [14, 10, "B"], [14, 11, "B"], [14, 12, "B"], [14, 13, "S"]],
  },
  {
    id: "dabbawala", name: "Dabba Express", detail: "Lunch delivered. Punch included.",
    palette: palette("#fff6df", "#c5c8ba", "#83c3c6"), hair: "#352725",
    rows: [
      "....OOOOOOOO....", "...OLLLLLLLLO...", "..OLLLLLLLLLLO..", "..OllllllllllO..",
      "..OHSSSSSSSSHO..", "..OSSSSSSSSSSO..", "..OSSSSSSSSSSO..", "..OSSSOOOOSSSO..",
      "...OSSSMMSSSO...", "....OSSSSSSO....", "...OFFFOFFFFO...", "..OFFFFOFFFFFO..",
      ".OSSOFFOFFFOSSO.", ".OSSOFFOFFFOSSO.", ".OOO.OJJJJO.OOO.", "....OFFFFFFO....",
      "....OFFOOFFO....", "....OFFOOFFO....", "....OSSOOSSO....", "...OOOOOOOOOO...",
    ],
    prop: [[13, 13, "O"], [14, 13, "O"], [12, 14, "O"], [13, 14, "L"], [14, 14, "l"], [15, 14, "O"], [12, 15, "O"], [13, 15, "T"], [14, 15, "l"], [15, 15, "O"], [12, 16, "O"], [13, 16, "L"], [14, 16, "l"], [15, 16, "O"], [12, 17, "O"], [13, 17, "O"], [14, 17, "O"], [15, 17, "O"]],
  },
  {
    id: "gogo", name: "Crime Master Gogo", detail: "Andaz Apna Apna · cape chaos",
    palette: palette("#e74664", "#a42e52", "#bdb3d7"), hair: "#272432", fixedEyes: true,
    rows: [
      ".....OOOOOO.....", "...OOHHHHHHOO...", "..OHHHHHHHHHHO..", "..OHHHHHHHHHHO..",
      "..OHSSSSSSSSHO..", "..OSOOOOOOOOSO..", "..OSOLLOOLLOSO..", "..OSSSSMMSSSSO..",
      ".O.OSSSSSSSSO.O.", ".OFOOSSSSSSOOFO.", ".OFFOFFOOFFOFFO.", ".OFFFOFTTFOFFFO.",
      ".OFSOFFFFFFOSFO.", ".OFSOFFJJFFOSFO.", "OFFFOFFffFFOFFFO", "OFFfOFFFFFFOfFFO",
      "OFFfOPPOOPPOfFFO", "OFFfOPPOOPPOfFFO", ".OOOBBBOOBBBOOO.", "...OOOOOOOOOO...",
    ],
  },
  {
    id: "kaali-peeli", name: "Meter Down", detail: "Kaali-peeli. Maximum horsepower.",
    palette: palette("#f6c64b", "#c38b32", "#9ed9df"), skin: "#9aaeb7",
    rows: [
      "......OOOO......", ".....OLLLLO.....", "...OOOOOOOOOO...", "..OFFFFFFFFFFO..",
      "..OFTTTTTTTTFO..", ".OOFTTTTTTTTFOO.", ".OlFTTTTTTTTFlO.", "..OFFFFFFFFFFO..",
      "..OLLOOOOOLLLO..", "...ONNNNNNNNO...", "..OONNLLLLNNOO..", ".OllONNNNNNOllO.",
      ".OllOFFJJFFOllO.", ".OSSOFFFFFFOSSO.", ".OOO.OFFFFO.OOO.", "....OONNNNOO....",
      "...ONNOOONNNO...", "...ONNO..ONNO...", "...ONNO..ONNO...", "...OOOO..OOOO...",
    ],
  },
  {
    id: "raju", name: "Raju", detail: "Hera Pheri · big plans, tiny pixels",
    palette: palette("#ffe071", "#d99d3d", "#d76b4a"), hair: "#453228",
    rows: [
      "....OOOOOOOO....", "...OHHHHHHHHO...", "..OHHHHHHHHHHO..", "..OHHSSSSSSSHO..",
      "..OHSSSSSSSSHO..", "..OSSSSSSSSSSO..", "..OSSSSSSSSSSO..", "..OsSSSMMSSSsO..",
      "...OSSSSSSSSO...", "....OSSSSSSO....", "...OFOSSSSOFO...", "..OFFFOFFOFFFO..",
      ".OFTOFFTFFOFTFO.", ".OSSOFFFFTFOSSO.", ".OOO.OJJJJO.OOO.", ".....OPPPPO.....",
      ".....OPPPPO.....", ".....OPOOPO.....", "....OLLOOLLO....", "....OOOOOOOO....",
    ],
  },
  {
    id: "monsoon", name: "Monsoon Mode", detail: "Forecast: scattered uppercuts.",
    palette: palette("#f4cc48", "#c99234", "#76c4cc"),
    rows: [
      ".......OO.......", ".....OOFFOO.....", "...OOFFFFFFOO...", ".OOFFfFFfFFfFOO.",
      "OFFFFfFFfFFfFFFO", "OOOOOOOOOOOOOOOO", "..OFSSSSSSSSFO..", "..OFSSSMMSSSFO..",
      "..OFFSSSSSSFFO..", "...OFFSSSSFFO...", "...OFFFOFFFFO...", "..OFFFFOFFFFFO..",
      ".OFFOFFOFFFFOFO.", ".OFFOFFTFFFFOFO.", ".OSSOFFOFFFFSSO.", ".OOO.OJJJJO.OOO.",
      "....OFFFFFFO....", "....OFFOOFFO....", "...OTTTOOTTTO...", "...OOOOOOOOOO...",
    ],
    eyeOffset: 1,
  },
  {
    id: "ember", name: "Ember Akhada", detail: "Arcade-inspired · masked fire fighter",
    palette: palette("#e9ad38", "#ba6e28", "#f56743"), hair: "#272432",
    rows: [
      ".....OOOOOO.....", "....OFFFFFFO....", "...OFFffffFFO...", "..OFFOOOOOOFFO..",
      "..OFFSSSSSSFFO..", "..OFSSSSSSSSFO..", "..OFTTTTTTTTFO..", "..OFFTTttTTFFO..",
      "...OFFTTTTFFO...", "....OOOOOOOO....", "...OFFONNOFFO...", "..OSSFONNOFSSO..",
      ".OSSOFFNNFFOSSO.", ".OSSOFFNNFFOSSO.", ".OOO.OJJJJO.OOO.", ".....OFFffO.....",
      "....OFFOOFFO....", "....OFFOOFFO....", "....ONNOONNO....", "...OOOOOOOOOO...",
    ],
    shortEyes: true,
  },
  {
    id: "frost", name: "Baraf Boss", detail: "Arcade-inspired · ice-cold defence",
    palette: palette("#56bcd4", "#3985b2", "#d1f7f3"), hair: "#263449",
    rows: [
      ".....OTTOOO.....", "....OTFFTFFO....", "...OFFTTTFFFO...", "..OFFOOOOOOFFO..",
      "..OFFSSSSSSFFO..", "..OFSSSSSSSSFO..", "..OFTTTTTTTTFO..", "..OFFTtTTtTFFO..",
      "...OFFTTTTFFO...", "....OOOOOOOO....", "..OOFFONNOFFOO..", ".OLTFFONNOFFTLO.",
      ".OLLOFFNNFFOLLO.", ".OLLOFFNNFFOLLO.", ".OOO.OJJJJO.OOO.", ".....OFFffO.....",
      "....OFFOOFFO....", "....OFFOOFFO....", "....ONNOONNO....", "...OOOOOOOOOO...",
    ],
    shortEyes: true,
  },
];

export const fighterStyle = (id) => FIGHTER_ROSTER.find((style) => style.id === id);
