import googleTagManager from '@analytics/google-tag-manager';
import { useLocation } from '@solidjs/router';
import { Analytics } from 'analytics';
import { createEffect } from 'solid-js';

let plugins = [];

let {GOOGLE_TAG_MANAGER_ID }= import.meta.env;

if (GOOGLE_TAG_MANAGER_ID) {
  plugins.push(googleTagManager({ containerId: GOOGLE_TAG_MANAGER_ID}))
}

export const analytics = Analytics({
  app: 'arcanetable',
  plugins,
});

export function AnalyticsContext(props) {
  const location = useLocation();

  createEffect(() => {
    analytics.page({
      url: globalThis.location.origin + location.pathname,
      path: location.pathname,
      search: location.search,
    });
  });

  return props.children;
}
