import { createApp } from 'vue';
import App from '@/ui/App.vue';
import { openTimeline } from '@/ui/state';
import '@/styles/index.css';

const HOST_ID = 'st-yafaya-timeline-host';
const MENU_ITEM_ID = 'st-yafaya-timeline-menu-item';

function mountApp(): void {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    document.body.appendChild(host);
  }

  host.style.setProperty('display', 'contents', 'important');
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.replaceChildren();

  // manifest 只加载 JS；CSS 必须进入 shadow root 才能保持样式隔离。
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL(/* @vite-ignore */ './index.css', import.meta.url).href;
  shadow.appendChild(stylesheet);

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);
  createApp(App).mount(mountPoint);
}

function injectMenuButton(): boolean {
  const menu = document.getElementById('extensionsMenu');
  if (!menu) return false;
  if (document.getElementById(MENU_ITEM_ID)) return true;

  const container = document.createElement('div');
  container.className = 'extension_container interactable';
  container.innerHTML = `
    <a id="${MENU_ITEM_ID}" class="list-group-item" href="#" title="时间线管理">
      <i class="fa-solid fa-timeline"></i>
      <span>时间线管理</span>
    </a>
  `;

  container.addEventListener('click', event => {
    event.preventDefault();
    openTimeline();
    menu.style.display = 'none';
  });
  menu.appendChild(container);
  return true;
}

function start(): void {
  mountApp();
  if (injectMenuButton()) return;

  // 魔法棒菜单由宿主异步创建，成功注入后立即停止轮询。
  const timer = window.setInterval(() => {
    if (injectMenuButton()) window.clearInterval(timer);
  }, 500);
  window.setTimeout(() => window.clearInterval(timer), 20_000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
