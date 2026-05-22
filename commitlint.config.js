module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-length': [2, 'always', 300],
    'footer-max-length': [2, 'always', 100],
    'subject-max-length': [2, 'always', 100],
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'refactor', 'perf', 'style', 'test', 'docs', 'build', 'ops', 'chore'],
    ],
  },
};
