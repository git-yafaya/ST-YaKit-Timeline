import { createApp } from 'vue';
import App from '@/ui/App.vue';
import { HOST_ID, MENU_ITEM_ID, PRODUCT_NAME } from '@/branding';
import { openTimeline } from '@/ui/state';
import '@/styles/index.css';

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

function bindMenuItem(menu: HTMLElement, menuItem: HTMLElement): void {
  if (menuItem.dataset.yakitTimelineBound === 'true') return;

  let lastTouchActivation = 0;
  const activate = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    openTimeline();
    menu.style.display = 'none';
  };
  const activateTouch = (event: Event): void => {
    const now = Date.now();
    if (now - lastTouchActivation < 500) return;
    lastTouchActivation = now;
    activate(event);
  };

  menuItem.addEventListener('click', event => {
    if (Date.now() - lastTouchActivation < 700) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    activate(event);
  });
  menuItem.addEventListener('pointerup', event => {
    if (event.pointerType !== 'mouse') activateTouch(event);
  });
  menuItem.addEventListener('touchend', event => activateTouch(event), { passive: false });
  menuItem.style.touchAction = 'manipulation';
  menuItem.dataset.yakitTimelineBound = 'true';
}

function bindMagicWandButton(button: HTMLElement): void {
  if (button.dataset.yakitTimelineTouchBound === 'true') return;

  let lastTouchActivation = 0;
  let forwardingClick = false;

  // The host only listens for click. On mobile ST sets body touch-action:none,
  // so a real tap may never synthesize that click. Forward one touch activation
  // to the host button, then suppress any duplicate browser-generated click.
  button.addEventListener('click', event => {
    if (forwardingClick) {
      forwardingClick = false;
      return;
    }
    if (Date.now() - lastTouchActivation < 700) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  const activateTouch = (event: Event): void => {
    const now = Date.now();
    if (now - lastTouchActivation < 500) return;
    lastTouchActivation = now;
    event.preventDefault();
    event.stopPropagation();
    forwardingClick = true;
    button.click();
    forwardingClick = false;
  };

  button.addEventListener('pointerup', event => {
    if ((event as PointerEvent).pointerType !== 'mouse') activateTouch(event);
  });
  button.addEventListener('touchend', event => activateTouch(event), { passive: false });
  button.style.touchAction = 'manipulation';
  button.dataset.yakitTimelineTouchBound = 'true';
}

function injectMenuButton(): boolean {
  const menu = document.getElementById('extensionsMenu');
  if (!menu) return false;

  const existingMenuItem = document.getElementById(MENU_ITEM_ID);
  if (existingMenuItem) {
    bindMenuItem(menu, existingMenuItem);
  } else {
    const container = document.createElement('div');
    container.className = 'extension_container interactable';
    container.innerHTML = `
      <a id="${MENU_ITEM_ID}" class="list-group-item" href="#" title="${PRODUCT_NAME}">
        <i class="fa-solid fa-timeline"></i>
        <span>${PRODUCT_NAME}</span>
      </a>
    `;

    const menuItem = container.querySelector<HTMLElement>(`#${MENU_ITEM_ID}`);
    if (!menuItem) return false;
    bindMenuItem(menu, menuItem);
    menu.appendChild(container);
  }

  const magicWandButton = document.getElementById('extensionsMenuButton');
  if (!magicWandButton) return false;
  bindMagicWandButton(magicWandButton);
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
