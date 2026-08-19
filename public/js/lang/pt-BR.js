// Português (Brasil). Chaves planas; espaços reservados no estilo `{name}`
// são preenchidos por t(). tests/i18n.test.js garante que cada chave daqui
// exista também em de.js e en.js.
export default {
  // Datas (as datas imprecisas são formatadas por public/js/fuzzydate.js)
  'date.months': 'janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro',
  'date.dmy': '{d} de {month} de {y}',
  'date.my': '{month} de {y}',
  'date.circa': 'por volta de {v}',
  'date.before': 'antes de {v}',
  'date.after': 'depois de {v}',
  'date.range': '{a}–{b}',

  // Parentesco — os rótulos construídos vivem em public/js/kinship.js
  'kin.self': 'é você',
  'kin.related': 'parente ({n} passos)',
  'kin.none': 'nenhuma ligação conhecida',
  'kin.ancestor_far': 'ancestral, {g} gerações atrás',
  'kin.descendant_far': 'descendente, {g} gerações adiante',

  // Abas
  'tab.tree': 'Árvore',
  'tab.people': 'Pessoas',
  'tab.stories': 'Histórias',
  'tab.places': 'Lugares',

  // Interface
  'ui.save': 'Salvar',
  'ui.cancel': 'Cancelar',
  'ui.delete': 'Excluir',
  'ui.edit': 'Editar',
  'ui.close': 'Fechar',
  'ui.add': 'Adicionar',
  'ui.search': 'Buscar',
  'ui.settings': 'Configurações',
  'ui.logout': 'Sair',
  'ui.login': 'Entrar',
  'ui.username': 'Nome de usuário',
  'ui.password': 'Senha',
  'ui.email': 'E-mail',
  'ui.language': 'Idioma',
  'ui.name': 'Nome',
  'ui.yes': 'Sim',
  'ui.no': 'Não',
  'ui.ok': 'OK',
  'ui.back': 'Voltar',
  'ui.confirm_delete': 'Excluir mesmo?',

  // Primeira configuração
  'setup.title': 'Bem-vindo ao Ancestor Map',
  'setup.intro': 'Crie a primeira conta — ela será a conta de administração.',
  'setup.create': 'Criar conta',

  // Pessoa (campos estruturais; os campos do registro são f.*)
  'p.birth': 'Nascimento',
  'p.death': 'Falecimento',
  'p.birth_place': 'Local de nascimento',
  'p.death_place': 'Local de falecimento',
  'p.sex': 'Sexo',
  'sex.m': 'masculino',
  'sex.f': 'feminino',
  'sex.x': 'outro',

  // Campos do registro
  'f.notes': 'Anotações — o que você quer lembrar',
  'f.notes_ph': 'Hipóteses, perguntas em aberto, memórias.',
  'f.occupation': 'Profissão',
  'f.occupation_ph': 'Ferreira, professor …',
  'f.education': 'Formação',
  'f.religion': 'Religião',
  'f.nationality': 'Nacionalidade',
  'f.birth_name': 'Nome de solteiro(a)',
  'f.nickname': 'Apelido',
  'f.residence': 'Onde morou',
  'f.residence_ph': 'Hamburgo (1920–1935), depois São Paulo',
  'f.burial_place': 'Local de sepultamento',
  'f.cause_of_death': 'Causa da morte',
  'f.baptism': 'Batismo',
  'f.tags': 'Palavras-chave — separe com vírgula',
  'f.tags_ph': 'Imigrante, musicista',
  'f.phone': 'Telefone',
  'f.email': 'E-mail',
  'f.website': 'Site',
  'f.pinned': 'Fixado',

  // Seções do formulário
  'sec.leben': 'Vida',
  'sec.kontakt': 'Contato',

  // Uniões e filhos
  'union.ehe': 'Casamento',
  'union.partnerschaft': 'União',
  'union.unbekannt': 'Ligação',
  'role.leiblich': 'biológico',
  'role.adoptiert': 'adotado',
  'role.stief': 'enteado',
  'role.pflege': 'de criação',

  // Tipos de relação livre
  'rel.pate': 'Padrinho/Madrinha',
  'rel.trauzeuge': 'Testemunha de casamento',
  'rel.freunde': 'Amigos',
  'rel.nachbarn': 'Vizinhos',
  'rel.kollegen': 'Colegas',
  'rel.sonstig': 'Ligação',

  // Papéis de conta
  'role.admin': 'Administração',
  'role.editor': 'Edição',
  'role.viewer': 'Visualização',

  // Erros — o servidor envia estas chaves, o cliente as exibe
  'err.unexpected': 'Algo deu errado. Tente de novo em instantes.',
  'err.unauthorized': 'Faça login primeiro.',
  'err.forbidden': 'Sua conta não tem permissão para isso.',
  'err.notfound': 'Isso não existe (mais).',
  'err.invalid': 'Essa entrada não faz sentido assim.',
  'err.name_required': 'Um nome é obrigatório.',
  'err.rate_limited': 'Tentativas demais — espere um momento.',
  'err.login_failed': 'Nome de usuário ou senha incorretos.',
  'err.setup_done': 'A configuração inicial já foi concluída.',
  'err.username_taken': 'Esse nome de usuário já existe.',
  'err.password_short': 'A senha precisa de pelo menos 8 caracteres.',
  'err.invite_invalid': 'Este convite é inválido ou expirou.',
  'err.last_admin': 'A última conta de administração não pode ser removida.',
  'err.self_demote': 'Você não pode tirar a administração da sua própria conta.',
  'err.branch_ring': 'Um ramo não pode ficar pendurado em si mesmo.',
  'err.color_invalid': 'Isso não é uma cor válida.',
  'err.person_missing': 'Essa pessoa não existe.',
  'err.union_missing': 'Essa união não existe.',
  'err.child_is_partner': 'Alguém não pode ser filho da própria união.',
  'err.import_format': 'Este arquivo não é uma exportação do Ancestor Map.',
};
