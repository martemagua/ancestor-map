// Deutsch. Flat keys; `{name}`-style placeholders are filled by t().
// tests/i18n.test.js enforces that every key here exists in pt-BR.js and
// en.js too — add to all three or the tests fail.
export default {
  // Dates (fuzzy dates are formatted by public/js/fuzzydate.js from these)
  'date.months': 'Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember',
  'date.dmy': '{d}. {month} {y}',
  'date.my': '{month} {y}',
  'date.circa': 'um {v}',
  'date.before': 'vor {v}',
  'date.after': 'nach {v}',
  'date.range': '{a}–{b}',

  // Kinship fallbacks (the constructed labels live in public/js/kinship.js)
  'kin.self': 'das bist du',
  'kin.related': 'verwandt ({n} Schritte)',
  'kin.none': 'keine bekannte Verbindung',
  'kin.ancestor_far': 'Vorfahr:in, {g} Generationen zurück',
  'kin.descendant_far': 'Nachkomme, {g} Generationen weiter',

  // Tabs
  'tab.tree': 'Baum',
  'tab.people': 'Menschen',
  'tab.stories': 'Geschichten',
  'tab.places': 'Orte',

  // Common UI
  'ui.save': 'Speichern',
  'ui.cancel': 'Abbrechen',
  'ui.delete': 'Löschen',
  'ui.edit': 'Bearbeiten',
  'ui.close': 'Schließen',
  'ui.add': 'Hinzufügen',
  'ui.search': 'Suchen',
  'ui.settings': 'Einstellungen',
  'ui.logout': 'Abmelden',
  'ui.login': 'Anmelden',
  'ui.username': 'Benutzername',
  'ui.password': 'Passwort',
  'ui.email': 'E-Mail',
  'ui.language': 'Sprache',
  'ui.name': 'Name',
  'ui.yes': 'Ja',
  'ui.no': 'Nein',
  'ui.ok': 'OK',
  'ui.back': 'Zurück',
  'ui.confirm_delete': 'Wirklich löschen?',

  // Setup
  'setup.title': 'Willkommen bei Ancestor Map',
  'setup.intro': 'Lege das erste Konto an — es wird das Verwaltungskonto.',
  'setup.create': 'Konto anlegen',

  // Person basics (structural fields; registry fields are f.*)
  'p.birth': 'Geburt',
  'p.death': 'Tod',
  'p.birth_place': 'Geburtsort',
  'p.death_place': 'Sterbeort',
  'p.sex': 'Geschlecht',
  'sex.m': 'männlich',
  'sex.f': 'weiblich',
  'sex.x': 'divers',

  // Registry fields
  'f.notes': 'Notizen — was du dir merken willst',
  'f.notes_ph': 'Vermutungen, offene Fragen, Erinnerungen.',
  'f.occupation': 'Beruf',
  'f.occupation_ph': 'Schmiedin, Lehrer …',
  'f.education': 'Ausbildung',
  'f.religion': 'Religion',
  'f.nationality': 'Nationalität',
  'f.birth_name': 'Geburtsname',
  'f.nickname': 'Rufname',
  'f.residence': 'Wohnorte',
  'f.residence_ph': 'Hamburg (1920–1935), danach São Paulo',
  'f.burial_place': 'Begräbnisort',
  'f.cause_of_death': 'Todesursache',
  'f.baptism': 'Taufe',
  'f.tags': 'Stichworte — mit Komma trennen',
  'f.tags_ph': 'Auswanderer, Musikerin',
  'f.phone': 'Telefon',
  'f.email': 'E-Mail',
  'f.website': 'Website',
  'f.pinned': 'Angepinnt',

  // Form sections
  'sec.leben': 'Leben',
  'sec.kontakt': 'Kontakt',

  // Unions & children
  'union.ehe': 'Ehe',
  'union.partnerschaft': 'Partnerschaft',
  'union.unbekannt': 'Verbindung',
  'role.leiblich': 'leiblich',
  'role.adoptiert': 'adoptiert',
  'role.stief': 'Stiefkind',
  'role.pflege': 'Pflegekind',

  // Free-form relationship kinds
  'rel.pate': 'Pate/Patin',
  'rel.trauzeuge': 'Trauzeuge/Trauzeugin',
  'rel.freunde': 'Freunde',
  'rel.nachbarn': 'Nachbarn',
  'rel.kollegen': 'Kollegen',
  'rel.sonstig': 'Verbindung',

  // Roles
  'role.admin': 'Verwaltung',
  'role.editor': 'Bearbeiten',
  'role.viewer': 'Ansehen',

  // Errors — the server sends these keys, the client renders them
  'err.unexpected': 'Da ist etwas schiefgegangen. Versuch es gleich noch einmal.',
  'err.unauthorized': 'Bitte melde dich an.',
  'err.forbidden': 'Dafür fehlt deinem Konto die Berechtigung.',
  'err.notfound': 'Das gibt es nicht (mehr).',
  'err.invalid': 'Diese Eingabe ergibt so keinen Sinn.',
  'err.name_required': 'Ein Name muss sein.',
  'err.rate_limited': 'Zu viele Versuche — warte einen Moment.',
  'err.login_failed': 'Benutzername oder Passwort stimmen nicht.',
  'err.setup_done': 'Die Einrichtung ist schon abgeschlossen.',
  'err.username_taken': 'Diesen Benutzernamen gibt es schon.',
  'err.password_short': 'Das Passwort braucht mindestens 8 Zeichen.',
  'err.invite_invalid': 'Diese Einladung ist ungültig oder abgelaufen.',
  'err.last_admin': 'Das letzte Verwaltungskonto kann nicht weg.',
  'err.self_demote': 'Du kannst deinem eigenen Konto die Verwaltung nicht nehmen.',
  'err.branch_ring': 'Ein Zweig kann nicht in sich selbst hängen.',
  'err.color_invalid': 'Das ist keine gültige Farbe.',
  'err.person_missing': 'Diese Person gibt es nicht.',
  'err.union_missing': 'Diese Verbindung gibt es nicht.',
  'err.child_is_partner': 'Jemand kann nicht Kind der eigenen Verbindung sein.',
  'err.tree_ring': 'Jemand kann nicht der eigene Vorfahr sein.',
  'err.too_many_partners': 'Eine Verbindung hat höchstens zwei Partner — eine weitere Ehe ist eine eigene Verbindung.',
  'err.import_format': 'Diese Datei ist kein Ancestor-Map-Export.',
};
