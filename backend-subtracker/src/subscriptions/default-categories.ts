// The only place in code that holds the default category ids, in the order the API lists them.
// The dev database gets these rows from CategoriesSeeder; the seed migration spells the same values
// out literally.
export const DEFAULT_CATEGORIES = [
  // One category for video and music: services such as YouTube cover both.
  { id: '4c51fa28-9ec4-492c-a0bc-9d96923ed894', name: 'Streaming' },
  { id: 'a518aea0-884a-45b7-b1c7-cf64bcfb319c', name: 'Gry' },
  {
    id: '976831a8-723d-4967-b7a4-d5c34e2e00d7',
    name: 'Oprogramowanie i narzędzia',
  },
  { id: '26999174-d669-410b-9273-3823c53c86a5', name: 'Chmura i dane' },
  { id: 'a4f79d55-2a61-46ca-831e-0a4f6f2bba95', name: 'Edukacja' },
  { id: '531b18f7-458d-49a7-a4f1-a98625cca728', name: 'Zdrowie i sport' },
  { id: 'b62388d1-b508-41ae-aa73-3db22a63e12c', name: 'Prasa i książki' },
  { id: 'f69cf33d-f070-4c75-83ed-50bb0d6bd029', name: 'Dom i usługi' },
  { id: '8312d1ba-9f14-4fe2-b611-ebd2538c2721', name: 'Inne' },
] as const;
