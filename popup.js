// popup.js - 点击扩展图标的弹窗
document.getElementById('openDouyin').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.douyin.com' });
  window.close();
});