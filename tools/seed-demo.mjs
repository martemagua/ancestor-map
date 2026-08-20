#!/usr/bin/env node
// Seeds a fictional four-generation demo family into DATA_DIR — the crowd all
// map work is judged on, and the only data that ever appears in screenshots
// of this public repo. Every person is invented.
//
//   npm run seed                          # into ./data
//   DATA_DIR=/tmp/demo node tools/seed-demo.mjs
//
// Accounts are deliberately not created: a seeded install still walks you
// through the setup wizard.
import {
  createPerson, createUnion, addChild, upsertRelationship, createBranch, createStory,
} from '../server/routes.js';
import { db } from '../server/db.js';

if (db.prepare('SELECT COUNT(*) c FROM persons').get().c > 0) {
  console.error('This DATA_DIR already has people — seeding only into an empty family.');
  process.exit(1);
}

const P = {};
const person = (key, fields) => { P[key] = createPerson(fields).id; return P[key]; };
const union = (aKey, bKey, kind = 'ehe', started = '') =>
  createUnion({ partners: [P[aKey], P[bKey]].filter(Boolean), kind, started }).id;
const kids = (unionId, keys, role) => { for (const k of keys) addChild(unionId, P[k], role); };

// ---------------------------------------------------------------- branches
const brandt = createBranch({ name: 'Familie Brandt', color: '#A6743C', emoji: '🌾' }).id;
const weber = createBranch({ name: 'Familie Weber', color: '#E0A13B', emoji: '🧵', parent_id: brandt }).id;
const souza = createBranch({ name: 'Família Souza', color: '#3E7CB1', emoji: '🌊' }).id;

// ---------------------------------------------------------------- Brandt line (Germany)
person('friedrich', { name: 'Friedrich Brandt', sex: 'm', birth: '~1858', death: '1931', birth_place: 'Greifswald', death_place: 'Greifswald', occupation: 'Schmied', branches: [brandt] });
person('wilhelmine', { name: 'Wilhelmine Brandt', sex: 'f', birth: '1863-04-11', death: '<1941', birth_place: 'Anklam', death_place: 'Greifswald', branches: [brandt] });
const u1 = union('friedrich', 'wilhelmine', 'ehe', '1883');

person('otto', { name: 'Otto Brandt', sex: 'm', birth: '1885-06-02', death: '1957', birth_place: 'Greifswald', occupation: 'Schlosser', branches: [brandt] });
person('gustav', { name: 'Gustav Brandt', sex: 'm', birth: '1888', death: '1914..1918', cause_of_death: 'Gefallen', branches: [brandt] });
person('emma', { name: 'Emma Weber', sex: 'f', birth: '1892-12-24', death: '1975', birth_name: 'Brandt', branches: [weber] });
kids(u1, ['otto', 'gustav', 'emma']);

person('klara', { name: 'Klara Brandt', sex: 'f', birth: '~1890', death: '1963', birth_name: 'Hoffmann', birth_place: 'Stralsund', branches: [brandt] });
const u2 = union('otto', 'klara', 'ehe', '1910');
person('heinrich', { name: 'Heinrich Brandt', sex: 'm', birth: '1912-03-30', death: '1989', occupation: 'Lokführer', branches: [brandt] });
person('ernaB', { name: 'Erna Fischer', sex: 'f', birth: '1915-09-01', death: '2001', birth_name: 'Brandt', branches: [brandt] });
person('kurt', { name: 'Kurt Brandt', sex: 'm', birth: '1920', death: '1944', cause_of_death: 'Gefallen', branches: [brandt] });
kids(u2, ['heinrich', 'ernaB', 'kurt']);

person('august', { name: 'August Weber', sex: 'm', birth: '1887', death: '1954', occupation: 'Schneider', branches: [weber] });
const u3 = union('august', 'emma', 'ehe', '1912');
person('lotte', { name: 'Lotte Weber', sex: 'f', birth: '1914', death: '1998', branches: [weber] });
person('hansW', { name: 'Hans Weber', sex: 'm', birth: '1919-02-17', death: '1997', branches: [weber] });
kids(u3, ['lotte', 'hansW']);

person('margarete', { name: 'Margarete Brandt', sex: 'f', birth: '1916', death: '1995', birth_name: 'Schulz', branches: [brandt] });
const u4 = union('heinrich', 'margarete', 'ehe', '1936');
person('werner', { name: 'Werner Brandt', sex: 'm', birth: '1938-08-08', death: '2019', occupation: 'Ingenieur', branches: [brandt] });
person('helga', { name: 'Helga Neumann', sex: 'f', birth: '1941-01-05', birth_name: 'Brandt', branches: [brandt] });
person('dieter', { name: 'Dieter Brandt', sex: 'm', birth: '1946-11-11', branches: [brandt] });
kids(u4, ['werner', 'helga', 'dieter']);

person('paulF', { name: 'Paul Fischer', sex: 'm', birth: '1910', death: '1978', branches: [brandt] });
const u5 = union('paulF', 'ernaB', 'ehe', '1935');
person('ursula', { name: 'Ursula Fischer', sex: 'f', birth: '1937', branches: [brandt] });
person('rolf', { name: 'Rolf Fischer', sex: 'm', birth: '1942', death: '2020', branches: [brandt] });
kids(u5, ['ursula', 'rolf']);

person('ingrid', { name: 'Ingrid Brandt', sex: 'f', birth: '1942-05-19', birth_name: 'Lehmann', branches: [brandt] });
const u6 = union('werner', 'ingrid', 'ehe', '1962');
person('thomas', { name: 'Thomas Brandt', sex: 'm', birth: '1965-03-12', occupation: 'Lehrer', branches: [brandt] });
person('sabine', { name: 'Sabine Brandt', sex: 'f', birth: '1968-07-24', occupation: 'Ärztin', branches: [brandt] });
kids(u6, ['thomas', 'sabine']);

person('juergen', { name: 'Jürgen Neumann', sex: 'm', birth: '1939', branches: [brandt] });
const u7 = union('juergen', 'helga', 'ehe', '1963');
person('frank', { name: 'Frank Neumann', sex: 'm', birth: '1966', branches: [brandt] });
person('petra', { name: 'Petra Neumann', sex: 'f', birth: '1969', branches: [brandt] });
kids(u7, ['frank', 'petra']);

person('renate', { name: 'Renate Brandt', sex: 'f', birth: '1950', birth_name: 'Vogel', branches: [brandt] });
const u8 = union('dieter', 'renate', 'partnerschaft', '~1975');
person('tanja', { name: 'Tanja Brandt', sex: 'f', birth: '1978', branches: [brandt] });
kids(u8, ['tanja']);

// ---------------------------------------------------------------- Souza line (Brazil)
person('jose', { name: 'José Souza', sex: 'm', birth: '~1910', death: '1980', birth_place: 'Salvador', death_place: 'Salvador', occupation: 'Pescador', branches: [souza] });
person('luzia', { name: 'Luzia Souza', sex: 'f', birth: '1915', death: '1990', birth_name: 'Almeida', branches: [souza] });
const u9 = union('jose', 'luzia', 'ehe', '1935');
person('joao', { name: 'João Souza', sex: 'm', birth: '1938-01-20', death: '2015', birth_place: 'Salvador', death_place: 'São Paulo', occupation: 'Marceneiro', branches: [souza] });
person('antonio', { name: 'Antônio Souza', sex: 'm', birth: '1940', branches: [souza] });
kids(u9, ['joao', 'antonio']);

person('mariaF', { name: 'Maria Souza', sex: 'f', birth: '1942-06-13', birth_name: 'Ferreira', birth_place: 'São Paulo', branches: [souza] });
const u10 = union('joao', 'mariaF', 'ehe', '1963');
person('ana', { name: 'Ana Brandt Souza', sex: 'f', birth: '1970-09-30', birth_place: 'São Paulo', occupation: 'Arquiteta', branches: [souza] });
person('pauloS', { name: 'Paulo Souza', sex: 'm', birth: '1965-02-02', branches: [souza] });
person('beatriz', { name: 'Beatriz Souza', sex: 'f', birth: '1972-12-01', branches: [souza] });
kids(u10, ['ana', 'pauloS', 'beatriz']);

person('rita', { name: 'Rita Souza', sex: 'f', birth: '1944', birth_name: 'Barbosa', branches: [souza] });
const u11 = union('antonio', 'rita', 'ehe', '1965');
person('marcos', { name: 'Marcos Souza', sex: 'm', birth: '1968', branches: [souza] });
person('fernanda', { name: 'Fernanda Souza', sex: 'f', birth: '1971', branches: [souza] });
kids(u11, ['marcos', 'fernanda']);

person('duda', { name: 'Duda Souza', sex: 'f', birth: '1969', birth_name: 'Cardoso', branches: [souza] });
const u12 = union('pauloS', 'duda', 'ehe', '1995');
person('rafael', { name: 'Rafael Souza', sex: 'm', birth: '1999-04-04', branches: [souza] });
kids(u12, ['rafael']);

// A single known parent is a one-partner union.
person('camila', { name: 'Camila Souza', sex: 'f', birth: '2000-10-10', branches: [souza] });
const u13 = createUnion({ partners: [P.beatriz], kind: 'unbekannt' }).id;
addChild(u13, P.camila);

// ---------------------------------------------------------------- the marriage that joins the trees
const u14 = union('thomas', 'ana', 'ehe', '1993-05-08');
person('julia', { name: 'Julia Brandt', sex: 'f', birth: '1995-11-02', birth_place: 'Hamburg', branches: [brandt, souza] });
person('lucas', { name: 'Lucas Brandt', sex: 'm', birth: '1998-06-21', birth_place: 'Hamburg', branches: [brandt, souza] });
kids(u14, ['julia', 'lucas']);

// An adopted child, so the dashed elbow has something real to draw.
person('mia', { name: 'Mia Brandt', sex: 'f', birth: '2004-02-29', branches: [brandt] });
addChild(u14, P.mia, 'adoptiert');

// ---------------------------------------------------------------- beyond the tree
person('emily', { name: 'Emily Carter', sex: 'f', birth: '1995', birth_place: 'Portland' });
upsertRelationship({ a_id: P.julia, b_id: P.emily, kind: 'freunde', label: 'Austauschfamilie — seit dem Schuljahr 2012 eng verbunden' });
person('karlN', { name: 'Karl Neumann', sex: 'm', birth: '1936', death: '2011' });
upsertRelationship({ a_id: P.werner, b_id: P.karlN, kind: 'kollegen', label: 'Ein Leben lang im selben Werk' });
upsertRelationship({ a_id: P.ernaB, b_id: P.werner, kind: 'pate', label: 'Taufpatin' });
upsertRelationship({ a_id: P.pauloS, b_id: P.thomas, kind: 'trauzeuge', label: 'Trauzeuge 1993' });

// ---------------------------------------------------------------- stories
createStory({ title: 'Gefallen an der Somme', kind: 'krieg', date: '1916', text: 'Gustav kehrte nicht zurück. Sein Feldpostbrief vom März blieb der letzte.', people: [P.gustav] });
createStory({ title: 'Hochzeit in São Paulo', kind: 'hochzeit', date: '1993-05-08', place: 'São Paulo', text: 'Thomas und Ana heirateten im Garten der Familie Souza. Paulo hielt die Rede.', people: [P.thomas, P.ana, P.pauloS, P.joao, P.mariaF] });
createStory({ title: 'Umzug nach Hamburg', kind: 'umzug', date: '1994', place: 'Hamburg', text: 'Nach einem Jahr Fernbeziehung zog Ana zu Thomas nach Hamburg.', people: [P.ana, P.thomas] });
createStory({ title: 'Austauschjahr in Portland', kind: 'erlebnis', date: '2012..2013', place: 'Portland', text: 'Julias Jahr bei Familie Carter — der Anfang einer zweiten Familie.', people: [P.julia, P.emily] });
createStory({ title: 'Das Lied vom Meer', kind: 'anekdote', date: '~1975', place: 'Salvador', text: 'José sang beim Flicken der Netze immer dasselbe Lied. João konnte es bis zuletzt auswendig.', people: [P.jose, P.joao] });

// ---------------------------------------------------------------- coordinates
// Fixed, so the seed never calls Nominatim — the Orte map has pins out of the
// box, and the demo works offline.
const PLACES = {
  Greifswald: [54.096, 13.387], Anklam: [53.855, 13.693], Stralsund: [54.309, 13.081],
  Hamburg: [53.551, 9.994], Salvador: [-12.972, -38.501], 'São Paulo': [-23.551, -46.633],
  Portland: [45.515, -122.678],
};
for (const [place, [lat, lon]] of Object.entries(PLACES)) {
  db.prepare('UPDATE persons SET birth_lat=?, birth_lon=? WHERE birth_place=?').run(lat, lon, place);
  db.prepare('UPDATE persons SET death_lat=?, death_lon=? WHERE death_place=?').run(lat, lon, place);
  db.prepare('UPDATE stories SET lat=?, lon=? WHERE place=?').run(lat, lon, place);
}

const count = db.prepare('SELECT COUNT(*) c FROM persons').get().c;
console.log(`Seeded ${count} fictional people, ${db.prepare('SELECT COUNT(*) c FROM unions').get().c} unions, `
  + `${db.prepare('SELECT COUNT(*) c FROM stories').get().c} stories.`);
