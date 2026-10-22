// Composition root: picks the data sources for where this page was opened, builds the
// store and the views, and starts. This is the only file that knows every class.
//
//   http://localhost:8080                        served by the backend      -> LIVE, then DEMO
//   https://0-mousa-0.github.io/DUSK-1/           GitHub Pages               -> REPLAY, then DEMO
//   ...?live=https://x.trycloudflare.com         public read-only live link -> LIVE, REPLAY, DEMO
//   ...?demo                                     start with the simulator
import { AlertMonitor } from './core/alerts.js';
import { CommandHistory } from './core/commands.js';
import { Settings } from './core/settings.js';
import { MissionStore } from './core/store.js';
import { DemoSource } from './sources/demo-source.js';
import { LiveSource } from './sources/live-source.js';
import { ReplaySource } from './sources/replay-source.js';
import { DashboardApp } from './ui/app.js';
import { startDawnSky } from './ui/background.js';
import { CameraView } from './ui/camera-view.js';
import { ChartsView } from './ui/charts-view.js';
import { CommandsView } from './ui/commands-view.js';
import { DataView } from './ui/data-view.js';
import { HeaderView } from './ui/header-view.js';
import { LogView } from './ui/log-view.js';
import { OverviewView } from './ui/overview-view.js';
import { SystemView } from './ui/system-view.js';

async function reachable(url, method = 'GET') {
  try { return (await fetch(url, { method, cache: 'no-store' })).ok; } catch (e) { return false; }
}

async function chooseSources(params) {
  const live = params.get('live'), replayUrl = params.get('replay') || 'replay/replay.json';
  const [backend, recorded] = await Promise.all([live ? false : reachable('api/state'), reachable(replayUrl, 'HEAD')]);
  const list = [];
  if (live) list.push(new LiveSource(live));
  else if (backend) list.push(new LiveSource(''));
  if (recorded) list.push(new ReplaySource(replayUrl));
  list.push(new DemoSource());
  if (params.has('demo')) list.unshift(list.pop());
  return list;
}

const store = new MissionStore(), settings = new Settings();
const app = new DashboardApp({ store, settings, alerts: new AlertMonitor(settings), commands: new CommandHistory(),
  sources: await chooseSources(new URLSearchParams(location.search)) });
app.header = new HeaderView(app);
app.register('overview', new OverviewView(app));
app.register('camera', new CameraView(app));
app.register('charts', new ChartsView(app));
app.register('cmd', new CommandsView(app));
app.register('data', new DataView(app));
app.register('log', new LogView(app));
app.register('system', new SystemView(app));
app.useSource(0);
app.mount();
startDawnSky(document.getElementById('dawn'));
