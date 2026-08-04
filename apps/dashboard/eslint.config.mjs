import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          // 'app' (features) + 'nxs' (shell/layout) — cf. conventions du CLAUDE.md
          prefix: ['app', 'nxs'],
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: ['app', 'nxs'],
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    rules: {
      // Dashboard perso mono-utilisateur : les règles d'interaction clavier/ARIA
      // (nav clavier sur div cliquables, autofocus) n'apportent rien ici. On garde
      // en revanche label-has-associated-control (formulaires corrects = utile).
      '@angular-eslint/template/click-events-have-key-events': 'off',
      '@angular-eslint/template/interactive-supports-focus': 'off',
      '@angular-eslint/template/no-autofocus': 'off',
    },
  },
];
