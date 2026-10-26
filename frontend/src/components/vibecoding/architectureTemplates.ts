// Эксплорердегі «Құрылым қосу» мәзірі: жобаға дайын папкалар құрылымын бір басумен
// қосады (таңдалған папканың ішіне). Бар папка/файлдар қайта жасалмайды.

export interface ArchitectureTemplate {
  id: string;
  title: string;
  description: string;
  folders: string[];
  files?: { path: string; content: string }[];
}

const HTML_STARTER = `<!DOCTYPE html>
<html lang="kk">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Менің сайтым</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <h1>Сәлем, Әлем!</h1>
  <script src="js/main.js"></script>
</body>
</html>
`;

export const ARCHITECTURE_TEMPLATES: ArchitectureTemplate[] = [
  {
    id: 'website',
    title: 'Веб-сайт',
    description: 'HTML, CSS, JS және суреттер',
    folders: ['css', 'js', 'assets/images'],
    files: [
      { path: 'index.html', content: HTML_STARTER },
      { path: 'css/style.css', content: 'body {\n  margin: 0;\n  font-family: system-ui, sans-serif;\n}\n' },
      { path: 'js/main.js', content: "console.log('Сайт жүктелді');\n" },
    ],
  },
  {
    id: 'react',
    title: 'React қосымшасы',
    description: 'components, pages, hooks, utils, styles',
    folders: ['public', 'src/assets', 'src/components', 'src/pages', 'src/hooks', 'src/utils', 'src/styles', 'src/services'],
  },
  {
    id: 'node-api',
    title: 'Node.js API',
    description: 'routes → controllers → services → models',
    folders: ['src/routes', 'src/controllers', 'src/services', 'src/models', 'src/middleware', 'src/config', 'tests'],
  },
  {
    id: 'python',
    title: 'Python жобасы',
    description: 'app пакеті, тесттер, тәуелділіктер',
    folders: ['app/models', 'app/routes', 'app/services', 'tests'],
    files: [
      { path: 'app/__init__.py', content: '' },
      { path: 'requirements.txt', content: '' },
    ],
  },
  {
    id: 'clean',
    title: 'Clean Architecture',
    description: 'domain, application, infrastructure, presentation',
    folders: [
      'src/domain/entities',
      'src/domain/repositories',
      'src/application/usecases',
      'src/infrastructure/database',
      'src/infrastructure/api',
      'src/presentation/components',
      'src/presentation/pages',
    ],
  },
];
