import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { locale } from './lib/i18n/locale.ts';
import { setNativeLocale } from './lib/ipc/os.ts';

document.documentElement.lang = locale;
// Rust remembers the language so native UI strings follow it (folder picker, the "safe mode" dialog on the next launch).
void setNativeLocale(locale).catch(() => undefined);

const target = document.getElementById('app');
if (!target) throw new Error('Thiếu #app trong index.html');

export default mount(App, { target });
