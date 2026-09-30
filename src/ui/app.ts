import type { AppState, TrackerService } from '../app/services';
import { h } from './dom';
import { Banner } from './components/Banner';
import { LogView } from './views/LogView';
import { SettingsView, type SettingsSection } from './views/SettingsView';
import { TodayView } from './views/TodayView';
import type { View } from './views/View';

type Route = 'today' | 'log' | 'settings';

const ROUTES: { route: Route; label: string }[] = [
  { route: 'today', label: 'Today' },
  { route: 'log', label: 'Log' },
  { route: 'settings', label: 'Settings' },
];

export function parseRoute(hash: string): Route {
  const name = hash.replace(/^#\/?/, '');
  return ROUTES.some((r) => r.route === name) ? (name as Route) : 'today';
}

export interface AppOptions {
  settingsSections?: readonly SettingsSection[];
  /** Extra elements for the header (e.g. the sync badge). */
  headerExtras?: readonly ((service: TrackerService) => HTMLElement)[];
}

/** Build the app shell, wire the hash router and re-render on state changes. */
export function mountApp(
  root: HTMLElement,
  service: TrackerService,
  options: AppOptions = {},
): () => void {
  const main = h('main', { id: 'main', class: 'main', tabindex: -1 });
  const links = ROUTES.map(({ route, label }) =>
    h('a', { href: `#/${route}`, class: 'nav-link' }, label),
  );
  const banner = Banner(service);

  root.replaceChildren(
    h('a', { href: '#main', class: 'skip-link' }, 'Skip to content'),
    h(
      'header',
      { class: 'topbar' },
      h('h1', { class: 'app-title' }, 'Time Tracker'),
      ...(options.headerExtras ?? []).map((extra) => extra(service)),
    ),
    banner.el,
    main,
    h('nav', { class: 'tabbar', 'aria-label': 'Main' }, ...links),
    h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' }),
  );

  let view: View | null = null;
  let current: Route | null = null;

  const show = (focus: boolean): void => {
    const route = parseRoute(location.hash);
    if (route === current) return;
    current = route;
    view?.destroy();
    view =
      route === 'log'
        ? LogView(service)
        : route === 'settings'
          ? SettingsView(service, options.settingsSections)
          : TodayView(service);
    main.replaceChildren(view.el);
    ROUTES.forEach(({ route: r }, i) => {
      const link = links[i];
      if (!link) return;
      if (r === route) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (focus) view.el.querySelector<HTMLElement>('.view-title')?.focus();
  };

  const onHashChange = (): void => {
    show(true);
  };
  window.addEventListener('hashchange', onHashChange);
  show(false);

  const unsubscribe = service.store.subscribe((state: AppState) => {
    view?.update(state);
    banner.update(state);
  });

  return () => {
    unsubscribe();
    window.removeEventListener('hashchange', onHashChange);
    view?.destroy();
  };
}
