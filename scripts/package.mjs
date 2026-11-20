import { packager } from '@electron/packager';

await packager({
  dir: '.',
  name: 'Tideway',
  out: 'dist',
  overwrite: true,
  asar: true,
  appBundleId: 'app.tideway.browser',
  appCategoryType: 'public.app-category.utilities',
  ignore: /^\/(?:dist|test|scripts|\.github|\.npmrc)(?:\/|$)/
});
