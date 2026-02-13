export type Theme = {
  id: string;
  name: string;
  blurb: string;
  options: { dinner: string[]; activity: string[]; mood: string[] };
};

export const THEMES: Theme[] = [
  {
    id: "cottagecore-classic",
    name: "Cottagecore Classic",
    blurb: "Warm bread, soft blankets, candlelight, and gentle joy.",
    options: {
      dinner: ["Soup + fresh bread", "Pasta night", "Charcuterie + fruit", "Takeout plated nicely"],
      activity: ["Bake something sweet", "Cozy movie", "Board games", "Long chat + tea"],
      mood: ["Romantic", "Soft & slow", "Playful", "Deep & cozy"],
    },
  },
];

export function getTheme(id: string) {
  return THEMES.find(t => t.id === id);
}
