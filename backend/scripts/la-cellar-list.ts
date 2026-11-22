/** The LA-cellar list, parsed into wine identities. Shared by dry-run-list.ts and import-la-cellar.ts. */
export interface Input {
  label: string // exactly as the developer wrote it
  producer: string
  denomination: string
  vintage: number
  region: string
  quality_classification?: string
  vineyard?: string
  cuvee?: string
  note?: string // an assumption made when parsing the label
}

export const WINES: Input[] = [
  { label: '2019 Domaine Tempier Bandol', producer: 'Domaine Tempier', denomination: 'Bandol', vintage: 2019, region: 'Provence' },
  { label: '2019 Châteauneuf-du-Pape "La Crau"', producer: 'Domaine du Vieux Télégraphe', denomination: 'Châteauneuf-du-Pape', vintage: 2019, region: 'Rhône', cuvee: 'La Crau', note: 'ASSUMED producer (label had none): Vieux Télégraphe makes "La Crau"' },
  { label: '2018 Domaine Follin-Arbelet Aloxe-Corton', producer: 'Domaine Follin-Arbelet', denomination: 'Aloxe-Corton', vintage: 2018, region: 'Burgundy' },
  { label: '2017 Domaine Bernard Baudry Chinon La Croix Boissée', producer: 'Domaine Bernard Baudry', denomination: 'Chinon', vintage: 2017, region: 'Loire', vineyard: 'La Croix Boissée' },
  { label: '2017 Catherine et Pierre Breton Bourgueil Les Perrières', producer: 'Catherine et Pierre Breton', denomination: 'Bourgueil', vintage: 2017, region: 'Loire', vineyard: 'Les Perrières' },
  { label: '2017 Guido Porro Barolo Vigna Lazzairasco', producer: 'Guido Porro', denomination: 'Barolo', vintage: 2017, region: 'Piedmont', vineyard: 'Vigna Lazzairasco' },
  { label: '2019 Domaine William Fevre Chablis 1er Cru "Montée de Tonnerre"', producer: 'Domaine William Fèvre', denomination: 'Chablis', vintage: 2019, region: 'Burgundy', quality_classification: '1er Cru', vineyard: 'Montée de Tonnerre' },
  { label: '2018 clos du caillou cotes du rhone les quartz', producer: 'Clos du Caillou', denomination: 'Côtes du Rhône', vintage: 2018, region: 'Rhône', cuvee: 'Les Quartz' },
  { label: '2019 Domaine André Brunel Châteauneuf-du-Pape Cuvée Réservée', producer: 'Domaine André Brunel', denomination: 'Châteauneuf-du-Pape', vintage: 2019, region: 'Rhône', cuvee: 'Cuvée Réservée' },
  { label: '2018 burgaud bernard cote rotie', producer: 'Bernard Burgaud', denomination: 'Côte-Rôtie', vintage: 2018, region: 'Rhône' },
  { label: '2019 Domaine Saint-Damien Gigondas Vieilles Vignes', producer: 'Domaine Saint-Damien', denomination: 'Gigondas', vintage: 2019, region: 'Rhône', cuvee: 'Vieilles Vignes' },
  { label: '2017 Produttori del Barbaresco', producer: 'Produttori del Barbaresco', denomination: 'Barbaresco', vintage: 2017, region: 'Piedmont', note: 'ASSUMED denomination Barbaresco (base wine, no cru)' },
  { label: 'Terres Dorees (jean Paul Braun) Fleurie Grille Midi 2019', producer: 'Domaine des Terres Dorées', denomination: 'Fleurie', vintage: 2019, region: 'Beaujolais', cuvee: 'Grille Midi', note: 'Read "Braun" as Jean-Paul Brun; producer entered as Domaine des Terres Dorées' },
  { label: 'Sansonnet St Emilion 2017', producer: 'Château Sansonnet', denomination: 'Saint-Émilion', vintage: 2017, region: 'Bordeaux', note: 'ASSUMED "Château" prefix; no Grand Cru classification entered' },
  { label: 'St. Préfert Châteauneuf-du-Pape Auguste Favier Réserve 2019', producer: 'Domaine de Saint-Préfert', denomination: 'Châteauneuf-du-Pape', vintage: 2019, region: 'Rhône', cuvee: 'Réserve Auguste Favier' },
  { label: 'Clos des Papes Châteauneuf-du-Pape 2020', producer: 'Clos des Papes', denomination: 'Châteauneuf-du-Pape', vintage: 2020, region: 'Rhône', note: 'Control: known to have rich review coverage' },
]
