(() => {
  /************ 配置 ************/
  let REPLY_TEXT = "你好，已收到你的消息，稍后回复～"; // 可由 popup.js 覆盖
  const TYPE_DELAY = [40, 90];
  const SEND_DELAY = [500, 900];
  const COOLDOWN = 1500;
  /********************************/

  // === DeepSeek AI (added) ===
  let AI_KEY = String();
  const AI_BASE = "https://api.deepseek.com/v1/chat/completions";
  const AUTH_PREFIX = String.fromCharCode(66,101,97,114,101,114,32);
  async function aiClassify(text) {
    if (!AI_KEY || !text) return "other";
    try {
      const r = await fetch(AI_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": AUTH_PREFIX + AI_KEY },
        body: JSON.stringify({ model: "deepseek-chat", messages: [
          { role: "system", content: "你是抖音私信分类助手，只输出一个单词：spam / troll / scam / genuine / other" },
          { role: "user", content: text.slice(0, 500) }
        ], temperature: 0, max_tokens: 10 })
      });
      if (!r.ok) return "other";
      const d = await r.json();
      return (d.choices[0].message.content || "other").trim().toLowerCase();
    } catch (e) { return "other"; }
  }
  async function aiReply(text, category, history) {
    if (!AI_KEY) return REPLY_TEXT || "收到。";
    try {
      // 系统提示:优先用户自定义,否则默认
      let sysPrompt = AI_PERSONA && AI_PERSONA.trim()
        ? AI_PERSONA.trim()
        : "你是抖音用户本人,在和粉丝/朋友私信聊天。根据聊天历史,自然口语化地回复对方,不超过30字,不要暴露你是AI。";
      // 喷子:追加反驳指令
      if (category === "troll") {
        sysPrompt += " 注意:对方在挑衅/辱骂你,请机智有力地反驳怼回去,不卑不亢、有理有据,但不说脏话,不超过40字。";
      }
      const msgs = [{ role: "system", content: sysPrompt }];
      if (history && history.length) { for (const h of history) msgs.push(h); }
      msgs.push({ role: "user", content: text || "(对方发来消息)" });
      const r = await fetch(AI_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": AUTH_PREFIX + AI_KEY },
        body: JSON.stringify({ model: "deepseek-chat", messages: msgs, temperature: 0.8, max_tokens: 100 })
      });
      if (!r.ok) return REPLY_TEXT || "收到。";
      const d = await r.json();
      return (d.choices[0].message.content || "收到。").trim();
    } catch (e) { return REPLY_TEXT || "收到。"; }
  }
  function readLastIncomingMessage() {
    // 按"气泡视觉特征"识别对方消息:圆角 + 背景色 + 靠左
    // 这样长短消息都能读到(不再按文字长度/叶子节点过滤)
    try {
      const center = window.innerWidth / 2;
      const all = document.querySelectorAll('div, span, p');
      const bubbles = [];
      for (const el of all) {
        const t = (el.innerText || '').trim();
        if (!t || t.length === 0 || t.length > 800) continue;
        const st = getComputedStyle(el);
        const radius = parseFloat(st.borderTopLeftRadius) || 0;
        const bg = st.backgroundColor || '';
        const hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
        // 气泡特征:有圆角 + 有背景色
        if (radius < 4 || !hasBg) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 10 || r.top < 80) continue;
        // 避免选到超大容器(气泡宽度一般 < 视口 75%)
        if (r.width > window.innerWidth * 0.75) continue;
        const isLeft = r.left < center - 30 && r.right < center + 60;
        bubbles.push({ text: t, top: r.top, isLeft });
      }
      if (!bubbles.length) return null;
      bubbles.sort((a, b) => a.top - b.top);
      // 从最新往前找,取最后一条"靠左(对方)"的气泡
      for (let k = bubbles.length - 1; k >= 0; k--) {
        if (bubbles[k].isLeft && bubbles[k].text !== lastSentText) {
          return bubbles[k].text;
        }
      }
      return null;
    } catch (e) { return null; }
  }
  // 读当前打开会话的对方昵称(从聊天头部)
  function readCurrentChatNickname() {
    // 当前会话标题昵称:顶部区域(top 5-60)、加粗(fw>=500)、不在最左会话列表
    try {
      const cands = [];
      document.querySelectorAll('div, span, h1, h2, h3, p').forEach(el => {
        const t = (el.innerText || '').trim();
        if (!t || t.length === 0 || t.length > 24) return;
        if (el.children.length > 1) return;
        const r = el.getBoundingClientRect();
        // 顶部标题区: top 很靠上, left 在聊天区(> 250,避开左侧列表)
        if (r.top < 5 || r.top > 65) return;
        if (r.left < 250) return;
        if (r.width < 15) return;
        const fw = parseInt(getComputedStyle(el).fontWeight) || 400;
        cands.push({ text: t, top: r.top, left: r.left, fw });
      });
      if (!cands.length) return null;
      // 优先加粗的(fw>=500),再按最靠上
      cands.sort((a, b) => (b.fw - a.fw) || (a.top - b.top));
      return cands[0].text;
    } catch (e) { return null; }
  }

  // 扫描会话列表:按列表项容器,取每项第一行文字作为昵称
  function scanConversationList() {
    const names = [];
    const seen = new Set();
    const isJunk = (t) => !t || t.length === 0 || t.length > 20 ||
      /^\d+$/.test(t) || /^\d{1,2}:\d{2}/.test(t) ||
      ['系统通知','互动消息','粉丝','赞过','消息','通讯录','[图片]','[视频]','[表情]','[语音]','刚刚','昨天','星期'].some(j => t === j || t.startsWith(j));

    // 会话项容器锁定 [role="listitem"](实测命中)
    let items = document.querySelectorAll('[role="listitem"]');
    if (!items.length) items = document.querySelectorAll('#island_b69f5 li, ul li, div[data-uid]');

    for (const item of items) {
      try {
        const lines = (item.innerText || '').split('\n').map(x => x.trim()).filter(Boolean);
        // 取第一行有效文字作为昵称
        for (const line of lines) {
          if (!isJunk(line)) {
            if (!seen.has(line)) { seen.add(line); names.push(line); }
            break;
          }
        }
      } catch (e) {}
    }
    return names;
  }

  async function sendMessageViaEnter(editor) {
    if (!editor) return false;
    editor.focus();
    await sleep(rand(150, 400));
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    editor.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    editor.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    await sleep(rand(500, 1000));
    return true;
  }


  let locked = false;
  let lastSend = 0;
  let enabled = true; // UI toggle (persisted)
  let lastSentText = ''; // 最近发送的消息内容（防重复）
  let lastSentTime = 0; // 最近发送的时间
  let currentChatId = null; // 当前正在处理的会话标识
  const SAME_TEXT_COOLDOWN = 0; // 相同内容30秒内不重复发送
  const EXIT_COOLDOWN = 1500; // 退出会话后10秒可继续回复
  const exitedChats = new Map(); // 存储会话ID和退出时间 { chatId: exitTimestamp }
  const CHAT_REPLY_COOLDOWN = 1500;
  const chatReplyTimes = new Map();
  const repliedIncoming = new Set(); // 已回过的"对方消息",防同一条回两遍
  let WHITELIST = []; // 勾选的昵称
  let WHITELIST_MODE = false; // true=只回勾选的人(空则谁都不回), false=回所有人
  let AI_PERSONA = ""; // 用户自定义提示词(空=用默认人设)
  let CONV_MEMORY = {}; // 分人记忆 {昵称: [{role,content},...]}
  const AI_CONTEXT_MAX = 100; // 发给AI的最近条数(存储不限,只限发送量,防token爆) // 存储会话ID和最后回复时间 { chatId: replyTimestamp }
  let checkInterval = null; // 定时检测器

  const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const log = (...a) => console.log("[DY-HUMAN]", ...a);
  log('script loaded');

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /** 只取第一句话（按 。！？.!? 或换行分割） */
  function getFirstSentence(s) {
    if (!s || typeof s !== 'string') return '';
    const t = s.trim();
    const first = t.split(/[。！？.!?\n]+/)[0]?.trim();
    return first || t;
  }

  function simulateRealClick(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 6 || rect.height < 6) return false;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      pointerType: 'mouse',
      isPrimary: true
    };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    return true;
  }

  /* ========= 基础工具 ========= */

  function editorBox() {
    // 优先使用真正 contenteditable 文本框
    const ce = document.querySelector('div[contenteditable="true"][role="textbox"]');
    if (ce) return ce;
    const all = [...document.querySelectorAll('div[contenteditable="true"]')];
    if (all.length) return all[all.length - 1];
    return null;
  }

  function getRealSendButton() {
    // 找到红色 path，再向上找到最近的可点击容器（div/button/span）并返回
    const paths = [...document.querySelectorAll('path[fill="#FE2C55"]')];
    for (const p of paths) {
      try {
        const clickable = p.closest('button,div,span');
        if (clickable) {
          const r = clickable.getBoundingClientRect();
          const s = getComputedStyle(clickable);
          if (r.width > 8 && r.height > 8 && s.pointerEvents !== 'none' && s.visibility !== 'hidden') return clickable;
        }
      } catch (e) {}
      let el = p;
      for (let i = 0; i < 6 && el; i++) {
        el = el.parentElement;
        if (!el) break;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        if (r.width > 20 && r.height > 20 && s.pointerEvents !== "none" && s.visibility !== "hidden") {
          return el;
        }
      }
    }
    return null;
  }

  function findRedDotElement() {
    const selectors = [
      '#island_b69f5 span.PygT7Ced.e2e-send-msg-btn',
      '.unread, .badge, .dot, .red-dot, [data-unread], [data-count]'
    ];
    for (const s of selectors) {
      try {
        const el = document.querySelector(s);
        if (el) return el;
      } catch (e) {}
    }
    
    // 查找红色数字徽章（未读消息标识）
    const all = [...document.querySelectorAll('span,div')];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const bg = style.backgroundColor || '';
      const text = (el.innerText || el.textContent || '').trim();
      
      // 检查是否是红色圆形徽章（包含数字）
      if (r.width > 0 && r.width <= 30 && r.height <= 30 && r.width >= 12 && r.height >= 12) {
        // 检查红色背景
        const isRed = bg.includes('rgb(255,') || bg.includes('#fe2c55') || bg.includes('255, 44, 85') ||
                      bg.includes('rgb(254, 44, 85)') || bg.includes('rgba(254, 44, 85');
        
        // 检查是否包含数字（未读消息数量）
        const hasNumber = /^\d+$/.test(text) && parseInt(text) > 0;
        
        // 检查是否是圆形或接近圆形（宽高比接近1）
        const isRound = Math.abs(r.width - r.height) <= 4;
        
        if (isRed && hasNumber && isRound) {
          log('✅ 找到红色数字徽章（未读消息）：', text);
          return el;
        }
      }
      
      // 兼容旧的小红点查找逻辑
      if (r.width > 0 && r.width <= 18 && r.height <= 18) {
        if (bg.includes('rgb(255,') || bg.includes('#fe2c55')) return el;
      }
    }
    return null;
  }

  async function findRedDotElementAsync() {
    const direct = findRedDotElement();
    if (direct) return direct;
    
    // 查找所有会话列表项
    const list = document.querySelectorAll('#island_b69f5 li, ul li, div[data-uid], [role="listitem"]');
    for (const item of list) {
      try {
        item.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));
        item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
      } catch (e) {}
      await sleep(100);
      
      try {
        // 优先查找展开后的元素
        const expanded = item.querySelector('div.J2483ny0.noSemiGlobal span') || 
                        item.querySelector('span.PygT7Ced.e2e-send-msg-btn');
        if (expanded) return expanded;
        
        // 查找红色数字徽章
        const allElements = item.querySelectorAll('span, div');
        for (const el of allElements) {
          if (!item.contains(el)) continue;
          
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          const bg = style.backgroundColor || '';
          const text = (el.innerText || el.textContent || '').trim();
          
          // 检查是否是红色数字徽章
          if (r.width > 0 && r.width <= 30 && r.height <= 30 && r.width >= 12 && r.height >= 12) {
            const isRed = bg.includes('rgb(255,') || bg.includes('#fe2c55') || bg.includes('255, 44, 85') ||
                          bg.includes('rgb(254, 44, 85)') || bg.includes('rgba(254, 44, 85');
            const hasNumber = /^\d+$/.test(text) && parseInt(text) > 0;
            const isRound = Math.abs(r.width - r.height) <= 4;
            
            if (isRed && hasNumber && isRound && 
                style.visibility !== 'hidden' && style.display !== 'none') {
              log('✅ findRedDotElementAsync 找到红色数字徽章（未读：' + text + '）');
              return el;
            }
          }
        }
      } catch (e) {}
    }
    return null;
  }

  /** 从会话列表项中提取会话 ID（支持 data-uid、链接 /user/xxx 等） */
  function getChatIdFromItem(item) {
    if (!item) return null;
    const uid = item.getAttribute('data-uid') ||
                item.getAttribute('data-user-id') ||
                (item.querySelector('[data-uid]')?.getAttribute('data-uid'));
    if (uid) return String(uid);
    const link = item.querySelector('a[href*="/user/"]');
    if (link) {
      const m = (link.getAttribute('href') || '').match(/\/user\/(\d+)/);
      if (m) return m[1];
    }
    return null;
  }

  /** 将私信列表滚动到顶部，确保「从上到下」顺序与可见一致，便于优先处理最上方未读 */
  function scrollListToTop() {
    const selectors = [
      '#island_b69f5',
      '#island_b69f5 [style*="overflow"]',
      '#island_b69f5 > div > div',
      '[class*="Message"] [style*="overflow"]',
      'ul'
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && typeof el.scrollTop === 'number') {
          el.scrollTop = 0;
          log('📜 已滚动私信列表到顶部');
          return;
        }
      } catch (e) {}
    }
  }

  /** 检查会话是否在退出冷却期内（10秒内） */
  function isChatInExitCooldown(chatId) {
    if (!chatId) return false;
    const exitTime = exitedChats.get(String(chatId));
    if (!exitTime) return false;
    const elapsed = Date.now() - exitTime;
    if (elapsed >= EXIT_COOLDOWN) {
      // 超过10秒，清除记录
      exitedChats.delete(String(chatId));
      return false;
    }
    return true;
  }

  /** 检查会话是否在回复冷却期内（1秒内） */
  function isChatInReplyCooldown(chatId) {
    if (!chatId) return false;
    const replyTime = chatReplyTimes.get(String(chatId));
    if (!replyTime) return false;
    const elapsed = Date.now() - replyTime;
    if (elapsed >= CHAT_REPLY_COOLDOWN) {
      // 超过1秒，清除记录
      chatReplyTimes.delete(String(chatId));
      return false;
    }
    return true;
  }

  /** 记录会话的回复时间 */
  function recordChatReply(chatId) {
    if (chatId) {
      chatReplyTimes.set(String(chatId), Date.now());
      log('📝 已记录会话 ' + chatId + ' 的回复时间');
    }
  }

  /** 查找下一个有未读消息的会话（排除已处理的会话，但10秒后可继续回复） */
  async function findNextUnreadChat(excludeChatId = null) {
    try {
      const processedChatId = excludeChatId || currentChatId ? String(excludeChatId || currentChatId) : null;

      scrollListToTop();
      await sleep(150);

      const chatListItems = document.querySelectorAll('#island_b69f5 li, ul li, div[data-uid], [role="listitem"]');
      log('🔍 开始查找下一个有未读消息的会话，当前会话列表项数量：', chatListItems.length, '排除会话ID：', processedChatId || '无');
      
      for (const item of chatListItems) {
        try {
          const itemChatId = getChatIdFromItem(item);
          
          // 如果该会话在退出冷却期内（10秒内），跳过
          if (itemChatId && isChatInExitCooldown(itemChatId)) {
            const exitTime = exitedChats.get(String(itemChatId));
            const remain = Math.ceil((EXIT_COOLDOWN - (Date.now() - exitTime)) / 1000);
            log('⏸️ 会话 ' + itemChatId + ' 在退出冷却期内，还需 ' + remain + ' 秒');
            continue;
          }
          
          // 尝试触发鼠标事件，让未读标识显示
          item.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));
          item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
          await sleep(80);
          
          // 方法1: 查找红色数字徽章（未读消息数量标识）
          const allElements = item.querySelectorAll('span, div');
          for (const el of allElements) {
            if (!item.contains(el)) continue;
            
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            const bg = style.backgroundColor || '';
            const text = (el.innerText || el.textContent || '').trim();
            
            // 检查是否是红色数字徽章
            if (r.width > 0 && r.width <= 30 && r.height <= 30 && r.width >= 12 && r.height >= 12) {
              const isRed = bg.includes('rgb(255,') || bg.includes('#fe2c55') || bg.includes('255, 44, 85') ||
                            bg.includes('rgb(254, 44, 85)') || bg.includes('rgba(254, 44, 85');
              const hasNumber = /^\d+$/.test(text) && parseInt(text) > 0;
              const isRound = Math.abs(r.width - r.height) <= 4;
              
              if (isRed && hasNumber && isRound && 
                  style.visibility !== 'hidden' && style.display !== 'none') {
                log('✅ 找到红色数字徽章（未读：' + text + '），会话ID：', itemChatId || '未知');
                // 返回聊天条目本身，而不是徽章
                return item;
              }
            }
          }
          
          // 方法2: 查找该会话项中的小红点（优先查找该会话项内部的小红点）
          const redDot = item.querySelector('span.PygT7Ced.e2e-send-msg-btn') ||
                        item.querySelector('div.J2483ny0.noSemiGlobal span') ||
                        item.querySelector('span[style*="rgb(255"]') ||
                        item.querySelector('span[style*="#fe2c55"]');
          
          if (redDot && item.contains(redDot)) {
            // 检查小红点是否可见
            const rect = redDot.getBoundingClientRect();
            const style = getComputedStyle(redDot);
            if (rect.width > 0 && rect.height > 0 && 
                style.visibility !== 'hidden' && 
                style.display !== 'none') {
              log('✅ 找到小红点，会话ID：', itemChatId || '未知');
              return item; // 返回聊天条目
            }
          }
          
          // 方法3: 检查该会话项内是否有红色背景的小圆点
          for (const span of allElements) {
            if (!item.contains(span)) continue;
            const r = span.getBoundingClientRect();
            if (r.width > 0 && r.width <= 18 && r.height <= 18) {
              const bg = getComputedStyle(span).backgroundColor || '';
              const fill = span.querySelector('path')?.getAttribute('fill') || '';
              if (bg.includes('rgb(255,') || bg.includes('#fe2c55') || bg.includes('255, 44, 85') ||
                  fill === '#FE2C55' || fill === '#fe2c55') {
                log('✅ 通过背景色/填充色找到未读标识，会话ID：', itemChatId || '未知');
                return item; // 返回聊天条目
              }
            }
          }
        } catch (e) {
          log('⚠️ 检查会话项时出错：', e);
        }
      }
      
      // 如果没找到，尝试直接查找小红点，然后找到其父聊天条目
      const fallbackRedDot = findRedDotElement();
      if (fallbackRedDot) {
        const chatItem = fallbackRedDot.closest('li') || 
                        fallbackRedDot.closest('[data-uid]') ||
                        fallbackRedDot.closest('[role="listitem"]');
        const fallbackChatId = chatItem ? getChatIdFromItem(chatItem) : null;
        // 检查是否在退出冷却期内（10秒内）
        if (fallbackChatId && isChatInExitCooldown(fallbackChatId)) {
          const exitTime = exitedChats.get(String(fallbackChatId));
          const remain = Math.ceil((EXIT_COOLDOWN - (Date.now() - exitTime)) / 1000);
          log('⚠️ fallback 小红点属于刚退出的会话（还需 ' + remain + ' 秒），已排除，避免重复进入');
          return null;
        }
        if (chatItem) {
          log('✅ 通过fallback找到小红点，会话ID：', fallbackChatId || '未知');
          return chatItem;
        }
        return fallbackRedDot;
      }
      
      log('ℹ️ 未找到其他有未读消息的会话');
      return null;
    } catch (e) {
      log('❌ 查找下一个未读会话时出错：', e);
      return null;
    }
  }

  const humanClick = simulateRealClick;

  async function humanType(text, targetEl) {
    const el = targetEl || editorBox();
    if (!el) return false;

    el.focus();

    for (const ch of text) {
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, ch);
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: ch
        })
      );
      await sleep(rand(...TYPE_DELAY));
    }
    return true;
  }

  /** 获取当前会话的唯一标识（用于防重复处理） */
  function getCurrentChatId() {
    try {
      const url = window.location.href;
      const match = url.match(/\/user\/(\d+)/);
      if (match) return match[1];
      const editor = editorBox();
      if (editor) {
        const container = editor.closest('[data-uid], [data-user-id], li[data-*]');
        if (container) {
          const uid = container.getAttribute('data-uid') || container.getAttribute('data-user-id');
          if (uid) return uid;
        }
      }
      return url;
    } catch (e) {
      return Date.now().toString();
    }
  }

  /** 检查输入框是否已包含相同内容 */
  function editorHasSameText(text) {
    const el = editorBox();
    if (!el) return false;
    const current = (el.innerText || el.textContent || '').trim();
    return current === text.trim();
  }

  /** 检查是否应该发送（防重复） */
  function shouldSend(text) {
    const now = Date.now();
    const textTrim = text.trim();
    if (!textTrim) return false;
    if (lastSentText === textTrim && now - lastSentTime < SAME_TEXT_COOLDOWN) {
      log('⚠️ 相同内容在 ' + Math.floor((SAME_TEXT_COOLDOWN - (now - lastSentTime)) / 1000) + ' 秒内已发送，跳过');
      return false;
    }
    if (editorHasSameText(textTrim)) {
      log('⚠️ 输入框已包含相同内容，跳过发送');
      return false;
    }
    return true;
  }

  /** 通过粘贴事件写入输入框（兼容 contenteditable），并触发 input */
  function fillInputViaPaste(text, inputEl) {
    const el = inputEl || editorBox();
    if (!el) { log("输入框未找到"); return false; }
    el.focus();
    // 1. 先清空现有内容(选中全部删除)
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete', false, null);
    } catch (e) {}
    // 2. 只插入一次(execCommand 能触发 React onChange)
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) {}
    // 3. fallback: 只用 paste 事件(不再设 innerText,避免重复)
    if (!ok) {
      try {
        const pe = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
        pe.clipboardData.setData('text/plain', text);
        el.dispatchEvent(pe);
      } catch (e) {}
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return true;
  }

  function isChatSessionReady() {
    const box = editorBox();
    const btn = getRealSendButton();
    return !!(box && btn);
  }

  function createPanel() {
    if (document.getElementById('dy-human-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'dy-human-panel';
    panel.innerHTML = `
      <style>#dy-human-panel button:hover{opacity:.9}#dy-human-panel button:active{transform:scale(.98)}#dy-status{transition:background .2s,color .2s}</style>
      <div id="dy-panel-inner" style="
        font-family: 'Segoe UI', system-ui, sans-serif;
        font-size: 13px;
        color: #1a1a1a;
        line-height: 1.4;
      ">
        <div style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-weight: 700;
          font-size: 15px;
          letter-spacing: -0.02em;
          margin-bottom: 12px;
          padding-bottom: 10px;
          border-bottom: 1px solid rgba(0,0,0,0.06);
        ">
          <span>抖音自动回复</span>
          <button id="dy-collapse" type="button" title="收起" style="
            border:none;background:rgba(0,0,0,0.05);cursor:pointer;
            width:24px;height:24px;border-radius:6px;font-size:16px;line-height:1;
            color:#666;padding:0;
          ">−</button>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span style="color:#666;font-size:12px">状态</span>
          <span id="dy-status" style="
            display:inline-block;
            padding:2px 10px;
            border-radius:999px;
            font-size:12px;
            font-weight:600;
          ">初始化</span>
        </div>
        <div style="margin-bottom:12px">
          <span style="color:#666;font-size:12px">上次发送</span>
          <span id="dy-last" style="display:block;margin-top:2px;font-size:12px;color:#888">-</span>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <button id="dy-toggle" type="button" style="
            flex:1;
            padding:8px 12px;
            border:1px solid #e0e0e0;
            border-radius:8px;
            background:#f8f8f8;
            font-size:12px;
            font-weight:600;
            cursor:pointer;
            color:#333;
          ">开/关</button>
          <button id="dy-manual" type="button" style="
            flex:1;
            padding:8px 12px;
            border:none;
            border-radius:8px;
            background:linear-gradient(135deg,#FE2C55 0%,#ff4d6a 100%);
            color:#fff;
            font-size:12px;
            font-weight:600;
            cursor:pointer;
          ">手动回复</button>
        </div>
        <button id="dy-enable-auto" type="button" style="
          width:100%;
          padding:8px 12px;
          border:none;
          border-radius:8px;
          background:linear-gradient(135deg,#4CAF50 0%,#45a049 100%);
          color:#fff;
          font-size:12px;
          font-weight:600;
          cursor:pointer;
          margin-bottom:12px;
        ">启用自动回复</button>
        <div style="margin-bottom:6px">
          <label style="color:#666;font-size:12px">话术（仅发送第一句）</label>
        </div>
        <textarea id="dy-preview" rows="3" placeholder="例如：你好，稍后回复～" style="
          width:100%;
          box-sizing:border-box;
          margin-bottom:8px;
          padding:8px 10px;
          border:1px solid #e5e5e5;
          border-radius:8px;
          font-size:12px;
          font-family:inherit;
          resize:vertical;
          min-height:52px;
        "></textarea>
        <button id="dy-save" type="button" style="
          width:100%;
          padding:6px 12px;
          border:1px solid #e0e0e0;
          border-radius:6px;
          background:#fff;
          font-size:11px;
          color:#666;
          cursor:pointer;
        ">保存话术</button>
        <div style="margin-top:12px;margin-bottom:6px"><label style="color:#666;font-size:12px">DeepSeek API Key</label></div>
        <input type="password" id="dy-apikey" placeholder="sk-..." style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:8px 10px;border:1px solid #e5e5e5;border-radius:8px;font-size:12px;">
        <button id="dy-apikey-save" type="button" style="width:100%;padding:6px 12px;border:1px solid #e0e0e0;border-radius:6px;background:#fff;font-size:11px;color:#666;cursor:pointer">💾 保存 Key</button>
        <div style="margin-top:8px;font-size:11px;color:#999">发送:Enter 键 · 有 Key 走 AI</div>
        <div style="margin-top:12px;margin-bottom:6px"><label style="color:#666;font-size:12px">AI 人格/提示词(空=默认)</label></div>
        <textarea id="dy-persona" rows="3" placeholder="例如: 你是一个健身博主,说话活泼幽默,常推荐自己的健身课程..." style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:8px 10px;border:1px solid #e5e5e5;border-radius:8px;font-size:12px;font-family:inherit;resize:vertical"></textarea>
        <button id="dy-persona-save" type="button" style="width:100%;padding:6px 12px;border:1px solid #e0e0e0;border-radius:6px;background:#fff;font-size:11px;color:#666;cursor:pointer">💾 保存人格</button>
        <div style="margin-top:12px;margin-bottom:6px">
          <label style="color:#333;font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="dy-wl-mode"> <b>只回复勾选的人</b>
          </label>
          <div style="font-size:10px;color:#999;margin-top:2px">开:只回下面勾选的 · 关:回所有人</div>
        </div>
        <input type="hidden" id="dy-whitelist" value="">
        <button id="dy-scan" type="button" style="width:100%;margin-top:8px;padding:6px 12px;border:none;border-radius:6px;background:linear-gradient(135deg,#4a90e2,#357abd);color:#fff;font-size:11px;font-weight:600;cursor:pointer">🔍 读取当前对话昵称</button>
        <div id="dy-conv-list" style="margin-top:8px;max-height:180px;overflow-y:auto;border:1px solid #eee;border-radius:6px;display:none"></div>
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(0,0,0,0.06)">
          <div style="font-size:11px;color:#999;margin-bottom:6px">记忆备份(存到电脑,防丢失)</div>
          <div style="display:flex;gap:6px">
            <button id="dy-export" type="button" style="flex:1;padding:6px;border:1px solid #e0e0e0;border-radius:6px;background:#fff;font-size:11px;color:#666;cursor:pointer">⬇️ 导出</button>
            <button id="dy-import" type="button" style="flex:1;padding:6px;border:1px solid #e0e0e0;border-radius:6px;background:#fff;font-size:11px;color:#666;cursor:pointer">⬆️ 导入</button>
          </div>
          <input type="file" id="dy-import-file" accept=".json" style="display:none">
        </div>
      </div>`;
    Object.assign(panel.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      width: '280px',
      background: '#fff',
      border: '1px solid rgba(0,0,0,0.06)',
      boxShadow: '0 8px 24px rgba(0,0,0,0.1), 0 2px 6px rgba(0,0,0,0.04)',
      padding: '14px',
      zIndex: 99999999,
      borderRadius: '12px'
    });
    document.body.appendChild(panel);

    // 折叠/展开逻辑
    const inner = document.getElementById('dy-panel-inner');
    const collapseBtn = document.getElementById('dy-collapse');
    let collapsed = false;
    function applyCollapse() {
      if (collapsed) {
        // 收起:只显示一个小圆球
        panel.style.width = '48px';
        panel.style.height = '48px';
        panel.style.padding = '0';
        panel.style.borderRadius = '50%';
        panel.style.cursor = 'pointer';
        panel.style.display = 'flex';
        panel.style.alignItems = 'center';
        panel.style.justifyContent = 'center';
        panel.style.background = 'linear-gradient(135deg,#FE2C55 0%,#ff4d6a 100%)';
        if (inner) inner.style.display = 'none';
        panel.setAttribute('data-collapsed', '1');
        // 圆球里显示一个图标
        if (!document.getElementById('dy-ball-icon')) {
          const ball = document.createElement('span');
          ball.id = 'dy-ball-icon';
          ball.textContent = '💬';
          ball.style.cssText = 'font-size:22px;';
          panel.appendChild(ball);
        }
        const bi = document.getElementById('dy-ball-icon');
        if (bi) bi.style.display = '';
      } else {
        panel.style.width = '280px';
        panel.style.height = '';
        panel.style.padding = '14px';
        panel.style.borderRadius = '12px';
        panel.style.cursor = '';
        panel.style.display = '';
        panel.style.alignItems = '';
        panel.style.justifyContent = '';
        panel.style.background = '#fff';
        if (inner) inner.style.display = '';
        panel.removeAttribute('data-collapsed');
        const bi = document.getElementById('dy-ball-icon');
        if (bi) bi.style.display = 'none';
      }
      if (chrome.storage && chrome.storage.local) chrome.storage.local.set({ COLLAPSED: collapsed });
    }
    if (collapseBtn) {
      collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        collapsed = true;
        applyCollapse();
      });
    }
    // 点小圆球展开
    panel.addEventListener('click', (e) => {
      if (panel.getAttribute('data-collapsed') === '1') {
        collapsed = false;
        applyCollapse();
      }
    });
    // 恢复上次折叠状态
    if (chrome.storage && chrome.storage.local && chrome.storage.local.get) {
      chrome.storage.local.get({ COLLAPSED: false }, res => {
        collapsed = !!res.COLLAPSED;
        applyCollapse();
      });
    }

    const toggle = document.getElementById('dy-toggle');
    const manual = document.getElementById('dy-manual');
    const enableAutoBtn = document.getElementById('dy-enable-auto');
    const preview = document.getElementById('dy-preview');
    const saveBtn = document.getElementById('dy-save');

    toggle.addEventListener('click', () => {
      enabled = !enabled;
      chrome.storage && chrome.storage.local && chrome.storage.local.set({ ENABLED: enabled });
      updatePanel();
    });

    manual.addEventListener('click', () => tryAutoReply());

    enableAutoBtn.addEventListener('click', async () => {
      log('🚀 用户点击启用自动回复，开始自动展开私信栏...');
      const success = await autoHoverPrivateMessageButton();
      if (success) {
        log('✅ 私信栏已展开，自动回复功能已启用');
        enabled = true;
        chrome.storage && chrome.storage.local && chrome.storage.local.set({ ENABLED: true });
        updatePanel();
        // 等待私信栏完全展开后，开始检测小红点
        setTimeout(() => {
          if (enabled && !locked) {
            tryAutoReply();
          }
        }, 500);
      } else {
        log('⚠️ 无法自动展开私信栏，请手动点击私信按钮');
      }
    });

    saveBtn.addEventListener('click', () => {
      const v = (preview.value || '').trim();
      REPLY_TEXT = v || REPLY_TEXT;
      if (chrome.storage && chrome.storage.local && chrome.storage.local.set) {
        chrome.storage.local.set({ REPLY_TEXT: REPLY_TEXT }, () => {
          log('话术已保存');
          updatePanel();
        });
      }
      updatePanel();
    });

    const akBtn = document.getElementById('dy-apikey-save');
    if (akBtn) akBtn.addEventListener('click', () => {
      const el = document.getElementById('dy-apikey');
      const v = (el && el.value || '').trim();
      if (v) { AI_KEY = v; if (chrome.storage && chrome.storage.local) chrome.storage.local.set({ AI_KEY: v }); log('API Key saved'); }
      else log('API Key empty');
    });

    const personaBtn = document.getElementById('dy-persona-save');
    if (personaBtn) personaBtn.addEventListener('click', () => {
      const el = document.getElementById('dy-persona');
      AI_PERSONA = (el && el.value || '').trim();
      if (chrome.storage && chrome.storage.local) chrome.storage.local.set({ AI_PERSONA });
      log('AI 人格已保存:', AI_PERSONA ? AI_PERSONA.slice(0,20)+'...' : '(默认)');
    });

    const wlBtn = document.getElementById('dy-whitelist-save');
    if (wlBtn) wlBtn.addEventListener('click', () => {
      const el = document.getElementById('dy-whitelist');
      const raw = (el && el.value || '').trim();
      WHITELIST = raw ? raw.split(/[,，]/).map(x => x.trim()).filter(Boolean) : [];
      if (chrome.storage && chrome.storage.local) chrome.storage.local.set({ WHITELIST: raw });
      log('白名单已保存:', WHITELIST.length ? WHITELIST.join('/') : '(回所有人)');
    });

    // 读取会话 -> 勾选
    const scanBtn = document.getElementById('dy-scan');
    const convListEl = document.getElementById('dy-conv-list');
    // 已发现的昵称(累积),勾中的写入白名单
    const discovered = new Set(WHITELIST);
    function renderConvList(names) {
      if (!convListEl) return;
      convListEl.style.display = 'block';
      names.forEach(n => discovered.add(n));
      const list = [...discovered];
      if (!list.length) {
        convListEl.innerHTML = '<div style="padding:8px;color:#999;font-size:11px">未读到。先点开一个对话,再点读取。</div>';
        return;
      }
      convListEl.innerHTML = list.map(n => {
        const checked = WHITELIST.some(w => n.includes(w) || w.includes(n)) ? 'checked' : '';
        const safe = n.replace(/"/g, '&quot;');
        return '<label style="display:flex;align-items:center;gap:6px;padding:5px 8px;font-size:12px;cursor:pointer;border-bottom:1px solid #f5f5f5">' +
               '<input type="checkbox" class="dy-conv-cb" data-name="' + safe + '" ' + checked + '>' +
               '<span>' + safe + '</span></label>';
      }).join('');
      convListEl.querySelectorAll('.dy-conv-cb').forEach(cb => {
        cb.addEventListener('change', () => {
          const picked = [...convListEl.querySelectorAll('.dy-conv-cb:checked')].map(x => x.getAttribute('data-name'));
          WHITELIST = picked;
          const raw = picked.join(',');
          const wlInput = document.getElementById('dy-whitelist');
          if (wlInput) wlInput.value = raw;
          if (chrome.storage && chrome.storage.local) chrome.storage.local.set({ WHITELIST: raw });
          log('白名单(勾选):', picked.length ? picked.join('/') : '(回所有人)');
        });
      });
    }
    if (scanBtn) scanBtn.addEventListener('click', () => {
      const nick = readCurrentChatNickname();
      log('当前对话昵称:', nick || '(未读到)');
      renderConvList(nick ? [nick] : []);
    });

    // 白名单开关
    const wlModeEl = document.getElementById('dy-wl-mode');
    if (wlModeEl) {
      wlModeEl.addEventListener('change', () => {
        WHITELIST_MODE = wlModeEl.checked;
        if (chrome.storage && chrome.storage.local) chrome.storage.local.set({ WHITELIST_MODE });
        log('白名单模式:', WHITELIST_MODE ? '开(只回勾选)' : '关(回所有人)');
      });
    }

    // 导出记忆+设置到电脑 JSON 文件
    const exportBtn = document.getElementById('dy-export');
    if (exportBtn) exportBtn.addEventListener('click', () => {
      const data = {
        exported_at: new Date().toISOString(),
        AI_KEY: AI_KEY,
        WHITELIST: WHITELIST,
        CONV_MEMORY: CONV_MEMORY,
        REPLY_TEXT: REPLY_TEXT,
        AI_PERSONA: AI_PERSONA
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'douyin-ai-memory-' + new Date().toISOString().slice(0,10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      log('已导出记忆+设置到下载文件夹');
    });

    // 导入
    const importBtn = document.getElementById('dy-import');
    const importFile = document.getElementById('dy-import-file');
    if (importBtn && importFile) {
      importBtn.addEventListener('click', () => importFile.click());
      importFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result);
            if (data.AI_KEY) { AI_KEY = data.AI_KEY; const ak = document.getElementById('dy-apikey'); if (ak) ak.value = AI_KEY; }
            if (data.WHITELIST) WHITELIST = data.WHITELIST;
            if (data.CONV_MEMORY) CONV_MEMORY = data.CONV_MEMORY;
            if (data.REPLY_TEXT) REPLY_TEXT = data.REPLY_TEXT;
            if (data.AI_PERSONA !== undefined) { AI_PERSONA = data.AI_PERSONA; const pn2 = document.getElementById('dy-persona'); if (pn2) pn2.value = AI_PERSONA; }
            if (chrome.storage && chrome.storage.local) {
              chrome.storage.local.set({ AI_KEY, WHITELIST: WHITELIST.join(','), CONV_MEMORY, REPLY_TEXT });
            }
            const persons = Object.keys(CONV_MEMORY || {}).length;
            log('已导入: 白名单' + WHITELIST.length + '人, 记忆' + persons + '人');
            alert('导入成功! 白名单 ' + WHITELIST.length + ' 人, 记忆 ' + persons + ' 人');
          } catch (err) {
            log('导入失败:', err.message);
            alert('导入失败: 文件格式错误');
          }
        };
        reader.readAsText(file);
      });
    }


    if (chrome.storage && chrome.storage.local && chrome.storage.local.get) {
      chrome.storage.local.get({ REPLY_TEXT, ENABLED: true, AI_KEY: String(), WHITELIST: String(), CONV_MEMORY: {}, WHITELIST_MODE: false, AI_PERSONA: '' }, res => {
        CONV_MEMORY = res.CONV_MEMORY || {};
        WHITELIST_MODE = !!res.WHITELIST_MODE;
        AI_PERSONA = res.AI_PERSONA || '';
        const pn = document.getElementById('dy-persona');
        if (pn) pn.value = AI_PERSONA;
        const wlm = document.getElementById('dy-wl-mode');
        if (wlm) wlm.checked = WHITELIST_MODE;
        preview.value = res.REPLY_TEXT || REPLY_TEXT;
        REPLY_TEXT = res.REPLY_TEXT || REPLY_TEXT;
        AI_KEY = res.AI_KEY || String();
        const ak = document.getElementById('dy-apikey');
        if (ak) ak.value = AI_KEY;
        const rawWl = res.WHITELIST || '';
        WHITELIST = rawWl ? rawWl.split(/[,，]/).map(x => x.trim()).filter(Boolean) : [];
        const wl = document.getElementById('dy-whitelist');
        if (wl) wl.value = rawWl;
        enabled = typeof res.ENABLED === 'boolean' ? res.ENABLED : enabled;
        updatePanel();
      });
    } else {
      preview.value = REPLY_TEXT;
      updatePanel();
    }
  }

  function updatePanel() {
    const status = document.getElementById('dy-status');
    const last = document.getElementById('dy-last');
    const preview = document.getElementById('dy-preview');
    if (status) {
      status.textContent = enabled ? '已启用' : '已禁用';
      status.style.background = enabled ? 'rgba(0,180,90,0.12)' : 'rgba(0,0,0,0.06)';
      status.style.color = enabled ? '#009952' : '#666';
    }
    if (last) last.textContent = lastSend ? new Date(lastSend).toLocaleString() : '-';
    if (preview) preview.value = REPLY_TEXT;
  }

  function findChatItemFromDot(dotEl) {
    if (!dotEl) return null;
    try {
      const li = dotEl.closest && dotEl.closest('li');
      if (li) return li;
    } catch (e) {}
    try {
      const clickable = dotEl.closest && dotEl.closest('button,a,div[role="button"],div[role="link"],[onclick],[tabindex]');
      if (clickable) return clickable;
    } catch (e) {}
    let el = dotEl;
    for (let i = 0; i < 8 && el; i++) {
      if (el.matches && el.matches('div,li')) return el;
      el = el.parentElement;
    }
    return dotEl;
  }

  function findClickableAncestor(el) {
    if (!el) return null;
    try {
      const candidate = el.closest && el.closest('button,a,div[role="button"],div[role="link"],[onclick],[tabindex]');
      if (candidate) {
        const r = candidate.getBoundingClientRect();
        const s = getComputedStyle(candidate);
        if (r.width > 6 && r.height > 6 && s.pointerEvents !== 'none' && s.visibility !== 'hidden') return candidate;
      }
    } catch (e) {}
    let p = el;
    for (let i = 0; i < 8 && p; i++) {
      try {
        const r = p.getBoundingClientRect();
        const s = getComputedStyle(p);
        if (r.width > 6 && r.height > 6 && s.pointerEvents !== 'none' && s.visibility !== 'hidden') {
          const onclick = p.getAttribute && p.getAttribute('onclick');
          const role = p.getAttribute && p.getAttribute('role');
          const tabindex = p.getAttribute && p.getAttribute('tabindex');
          const cursor = s.cursor || '';
          if (onclick || role === 'button' || tabindex !== null || cursor.indexOf('pointer') !== -1) return p;
        }
      } catch (e) {}
      p = p.parentElement;
    }
    return null;
  }

  /** 查找私信按钮（用于自动悬停展开私信栏） */
  function findPrivateMessageButton() {
    const selectors = [
      'a[href*="/message"]',
      'a[href*="/im"]',
      'button:has-text("私信")',
      '[aria-label*="私信"]',
      '[title*="私信"]',
      'span:contains("私信")',
      'div:contains("私信")'
    ];
    
    // 方法1: 通过文本内容查找
    const allElements = [...document.querySelectorAll('a, button, div, span')];
    for (const el of allElements) {
      const text = (el.innerText || el.textContent || '').trim();
      if (text === '私信' || text.includes('私信')) {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (rect.width > 0 && rect.height > 0 && 
            style.visibility !== 'hidden' && 
            style.display !== 'none') {
          log('✅ 找到私信按钮（通过文本）：', text);
          return el;
        }
      }
    }
    
    // 方法2: 通过链接查找
    for (const sel of ['a[href*="/message"]', 'a[href*="/im"]', 'a[href*="/chat"]']) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          if (rect.width > 0 && rect.height > 0 && 
              style.visibility !== 'hidden' && 
              style.display !== 'none') {
            log('✅ 找到私信按钮（通过链接）：', sel);
            return el;
          }
        }
      } catch (e) {}
    }
    
    // 方法3: 通过aria-label或title查找
    for (const attr of ['aria-label', 'title']) {
      try {
        const el = document.querySelector(`[${attr}*="私信"]`);
        if (el) {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          if (rect.width > 0 && rect.height > 0 && 
              style.visibility !== 'hidden' && 
              style.display !== 'none') {
            log('✅ 找到私信按钮（通过' + attr + '）：', el.getAttribute(attr));
            return el;
          }
        }
      } catch (e) {}
    }
    
    log('⚠️ 未找到私信按钮');
    return null;
  }

  /** 自动悬停私信按钮1秒以展开私信栏 */
  async function autoHoverPrivateMessageButton() {
    const pmButton = findPrivateMessageButton();
    if (!pmButton) {
      log('⚠️ 未找到私信按钮，无法自动展开私信栏');
      return false;
    }
    
    try {
      log('🖱️ 开始自动悬停私信按钮...');
      
      // 滚动到可见区域
      pmButton.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      await sleep(200);
      
      // 触发鼠标进入事件（模拟悬停）
      pmButton.dispatchEvent(new MouseEvent('mouseenter', { 
        bubbles: true, 
        cancelable: true,
        view: window
      }));
      pmButton.dispatchEvent(new MouseEvent('mousemove', { 
        bubbles: true, 
        cancelable: true,
        view: window,
        clientX: pmButton.getBoundingClientRect().left + pmButton.getBoundingClientRect().width / 2,
        clientY: pmButton.getBoundingClientRect().top + pmButton.getBoundingClientRect().height / 2
      }));
      
      // 悬停1秒
      await sleep(1000);
      
      // 保持悬停状态，等待私信栏展开
      await sleep(500);
      
      log('✅ 已自动悬停私信按钮1秒，私信栏应已展开');
      return true;
    } catch (e) {
      log('❌ 自动悬停私信按钮时出错：', e);
      return false;
    }
  }

  /** 退出会话按钮：发送后点击返回上级，继续等待小红点 */
  function findExitButton() {
    const exitTexts = ['退出会话', '退出', '离开会话'];
    const bySelector = [
      '#island_b69f5 > div > ul:nth-child(5) > div > li > div > div > div.vgonMAXk._VnLWL_m > div > div > div.w5duGc5Q.n4DfbtPU > div > div.gk_vYpRE > span',
      '#island_b69f5 div.w5duGc5Q.n4DfbtPU div.gk_vYpRE span',
      '#island_b69f5 div.gk_vYpRE span'
    ];
    for (const sel of bySelector) {
      try {
        const nodes = document.querySelectorAll(sel);
        for (const el of nodes) {
          const t = (el.innerText || '').trim();
          if (exitTexts.some(x => t === x)) return el;
        }
        if (nodes.length === 1) return nodes[0];
      } catch (e) {}
    }
    const candidates = [...document.querySelectorAll('button,div,span')];
    for (const c of candidates) {
      if (!c.innerText) continue;
      const t = c.innerText.trim();
      if (exitTexts.includes(t)) return c;
    }
    return null;
  }

  async function tryAutoReply() {
    if (!enabled) return;
    if (locked) {
      log('⏸️ 已有任务进行中，跳过');
      return;
    }
    if (Date.now() - lastSend < COOLDOWN) {
      const remain = Math.ceil((COOLDOWN - (Date.now() - lastSend)) / 1000);
      log('⏸️ 冷却中，还需 ' + remain + ' 秒');
      return;
    }

    const red = await findRedDotElementAsync();
    if (!red) return;

    // 先通过小红点找到对应的会话ID，检查是否在1秒冷却期内
    let detectedChatId = null;
    try {
      const listItem = (red && red.closest && (
        red.closest('li') || 
        red.closest('[data-uid]') || 
        red.closest('[role="listitem"]') ||
        red.closest('div[data-uid]')
      )) || findChatItemFromDot(red);
      if (listItem) {
        detectedChatId = getChatIdFromItem(listItem);
      }
    } catch (e) {}

    // 如果无法从列表项获取，尝试从当前页面URL获取（如果已在会话内）
    if (!detectedChatId) {
      detectedChatId = getCurrentChatId();
    }

    // 检查该会话是否在1秒回复冷却期内
    if (detectedChatId && isChatInReplyCooldown(detectedChatId)) {
      const replyTime = chatReplyTimes.get(String(detectedChatId));
      const remain = Math.ceil((CHAT_REPLY_COOLDOWN - (Date.now() - replyTime)) / 1000);
      log('⏸️ 会话 ' + detectedChatId + ' 在1秒回复冷却期内，还需 ' + remain + ' 秒');
      return;
    }

    const chatId = getCurrentChatId();
    if (currentChatId === chatId && Date.now() - lastSend < COOLDOWN) {
      log('⏸️ 当前会话刚处理过，跳过');
      return;
    }

    locked = true;
    currentChatId = detectedChatId || chatId;
    log('✅ 发现未读小红点，开始自动回复流程（会话ID: ' + currentChatId + '）');

    try {
      chrome.storage && chrome.storage.local && chrome.storage.local.get({ REPLY_TEXT }, res => {
        REPLY_TEXT = res.REPLY_TEXT || REPLY_TEXT;
      });

      try { red.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
      red.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));
      red.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
      try {
        // 找到包含红色标识的聊天条目
        const li = red.closest && (red.closest('li') || red.closest('[data-uid]') || red.closest('[role="listitem"]'));
        if (li) {
          li.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));
          li.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
        }
      } catch (e) {}
      await sleep(rand(150, 350));

      // 找到包含红色标识的聊天条目（支持红色数字徽章）
      const listItem = (red && red.closest && (
        red.closest('li') || 
        red.closest('[data-uid]') || 
        red.closest('[role="listitem"]') ||
        red.closest('div[data-uid]')
      )) || findChatItemFromDot(red) || red;
      let expandedEl = null;
      try {
        if (listItem) {
          expandedEl = listItem.querySelector('div.J2483ny0.noSemiGlobal > span > span')
            || listItem.querySelector('span.PygT7Ced.e2e-send-msg-btn');
        }
      } catch (e) {}

      if (expandedEl) {
        const clickableExpanded = findClickableAncestor(expandedEl) || expandedEl.closest && expandedEl.closest('div,button,span');
        log('发现展开后的小红点，点击其可点击祖先：', clickableExpanded || expandedEl);
        if (clickableExpanded) {
          simulateRealClick(clickableExpanded);
          await sleep(rand(300, 900));
        } else {
          simulateRealClick(expandedEl);
          await sleep(rand(300, 900));
        }
      } else {
        const chat = findChatItemFromDot(red) || red;
        const clickable = findClickableAncestor(chat) || chat;
        log('未找到展开小红点，回退点击聊天项：', clickable);
        simulateRealClick(clickable);
        await sleep(rand(300, 900));
      }

      let editor = editorBox();
      if (!editor) {
        const fallbackSelector = '#island_b69f5 span.J2483ny0.noSemiGlobal';
        const fallback = document.querySelector(fallbackSelector);
        if (fallback) {
          log('未检测到 editor，尝试点击 fallback 选择器', fallbackSelector);
          simulateRealClick(fallback);
          await sleep(rand(200, 400));
          editor = editorBox();
        }
      }

      if (!editor) {
        let tried = false;
        for (let attempt = 0; attempt < 3 && !editor; attempt++) {
          try {
            const tryTarget = findClickableAncestor(red) || red;
            if (!tryTarget) break;
            tried = true;
            log('重试进入会话，第 ' + (attempt + 1) + ' 次，目标：', tryTarget);
            tryTarget.scrollIntoView({ block: 'center', inline: 'center' });
            tryTarget.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
            tryTarget.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            simulateRealClick(tryTarget);
            await sleep(rand(300, 700) + attempt * 200);
            editor = editorBox();
          } catch (e) {}
        }
        if (!editor && tried) log('[DY-HUMAN] ⚠️ 多次尝试后仍未打开会话');
      }

      if (!editor) {
        console.warn('[DY-HUMAN] 未能进入会话，跳过本次回复');
        locked = false;
        currentChatId = null;
        return;
      }

      try { simulateRealClick(editor); await sleep(rand(100, 250)); } catch (e) {}

      // 读当前对话昵称(白名单 + 记忆共用)
      const chatNick = readCurrentChatNickname() || ('会话' + String(currentChatId).slice(-6));
      log('当前对话昵称:', chatNick);
      // 白名单检查:开关开=只回勾选的人(空则谁都不回);开关关=回所有人
      if (WHITELIST_MODE) {
        const hit = chatNick && WHITELIST.some(w => chatNick.includes(w) || w.includes(chatNick));
        if (!hit) {
          log('⏸️ 白名单模式:此人未勾选,跳过');
          locked = false;
          currentChatId = null;
          return;
        }
        log('✅ 白名单模式:此人已勾选,继续回复');
      }

      // 读对方消息 + AI 生成回复
      const incomingText = readLastIncomingMessage() || '';
      if (incomingText) log('✅ 读到对方消息:', incomingText.slice(0, 60));
      else log('⚠️ 没读到对方消息,用通用回复');

      // 按"对方消息内容"去重:同一条只回一次(修复回两遍)
      const dedupKey = String(currentChatId) + ':' + incomingText;
      if (incomingText && repliedIncoming.has(dedupKey)) {
        log('⏸️ 这条已回过,跳过');
        locked = false;
        currentChatId = null;
        return;
      }

      const category = await aiClassify(incomingText);
      log('分类:', category);
      let oneLine;
      if (category === 'spam' || category === 'scam') {
        oneLine = ['不感兴趣,谢谢。','已读。','感谢关注。','嗯。'][rand(0,3)];
      } else {
        // genuine / other / troll 都走 AI(troll 会被追加反驳指令)
        // 存储全记,只发最近 AI_CONTEXT_MAX 条给AI(防token爆)
        const fullHist = CONV_MEMORY[chatNick] || [];
        const history = fullHist.length > AI_CONTEXT_MAX ? fullHist.slice(-AI_CONTEXT_MAX) : fullHist;
        oneLine = await aiReply(incomingText, category, history);
      }
      if (!oneLine) oneLine = REPLY_TEXT || '收到。';
      if (oneLine.length > 50) oneLine = oneLine.slice(0, 50);
      log('回复:', oneLine);

      fillInputViaPaste(oneLine, editor);
      await sleep(rand(150, 300));

      await sendMessageViaEnter(editor);
      lastSentText = oneLine;
      lastSentTime = Date.now();
      lastSend = Date.now();
      recordChatReply(currentChatId);
      if (incomingText) { repliedIncoming.add(dedupKey); if (repliedIncoming.size > 500) repliedIncoming.clear(); }
      // 存入分人记忆
      try {
        if (!CONV_MEMORY[chatNick]) CONV_MEMORY[chatNick] = [];
        if (incomingText) CONV_MEMORY[chatNick].push({ role: 'user', content: incomingText });
        CONV_MEMORY[chatNick].push({ role: 'assistant', content: oneLine });
        // 标记最后活跃时间(用于人数超限时淘汰最久没聊的)
        CONV_MEMORY[chatNick]._t = Date.now();
        // 存储不设上限:全部记住(不裁剪)
        // 人数上限 1000:超了淘汰最久没聊的
        const persons = Object.keys(CONV_MEMORY);
        if (persons.length > 1000) {
          persons.sort((a, b) => (CONV_MEMORY[a]._t || 0) - (CONV_MEMORY[b]._t || 0));
          for (let k = 0; k < persons.length - 1000; k++) delete CONV_MEMORY[persons[k]];
        }
        if (chrome.storage && chrome.storage.local) chrome.storage.local.set({ CONV_MEMORY });
      } catch (e) {}
      log('📤 消息已发送 (enter)');
      await sleep(rand(...SEND_DELAY));
      await sleep(rand(300, 600));

      await sleep(rand(400, 800));

      // 退出当前会话，准备进入下一个会话
      const exitBtn = findExitButton();
      if (exitBtn) {
        log('🔄 点击退出会话，返回会话列表');
        simulateRealClick(exitBtn);
        const previousChatId = currentChatId;
        // 记录退出时间，10秒后可继续回复该会话
        if (previousChatId) {
          exitedChats.set(String(previousChatId), Date.now());
          log('📝 已记录会话 ' + previousChatId + ' 的退出时间，10秒后可继续回复');
        }
        currentChatId = null;
        await sleep(rand(1000, 1500));
        log('🔍 退出后等待页面稳定，准备查找下一个有未读消息的会话...');
        
        // 等待页面稳定后，查找下一个有小红点的会话
        await sleep(rand(1500, 2500));
        
        // 主动查找下一个有未读消息的会话（排除刚才处理的会话）
        const nextChatItem = await findNextUnreadChat(previousChatId);
        if (nextChatItem) {
          log('✅ 找到下一个有未读消息的会话，准备点击进入');
          
          // 找到可点击的元素（聊天条目本身或其内部的可点击元素）
          const clickableItem = findClickableAncestor(nextChatItem) || 
                               nextChatItem.querySelector('button, a, [role="button"], [role="link"]') ||
                               nextChatItem;
          
          // 滚动到可见区域
          try {
            clickableItem.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
            await sleep(rand(300, 500));
          } catch (e) {}
          
          // 触发鼠标事件
          clickableItem.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));
          clickableItem.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
          await sleep(rand(200, 400));
          
          // 点击进入会话
          log('🖱️ 点击进入下一个会话...');
          simulateRealClick(clickableItem);
          
          // 等待进入会话
          await sleep(rand(1000, 2000));
          
          // 重置锁定状态，允许进入下一个会话
          locked = false;
          
          // 延迟一点后开始处理下一个会话，确保页面已完全稳定
          setTimeout(() => {
            if (enabled && !locked) {
              log('🚀 开始处理下一个会话...');
              tryAutoReply();
            }
          }, rand(1000, 2000));
        } else {
          log('ℹ️ 未找到其他有未读消息的会话，等待新消息');
          locked = false;
        }
      } else {
        currentChatId = null;
        log('⚠️ 未找到退出按钮，但已清除会话状态');
        locked = false;
      }

      log('✅ 自动回复完成');
      try { updatePanel(); } catch (e) {}

    } catch (e) {
      console.error('[DY-HUMAN] 自动回复流程出错', e);
      currentChatId = null;
    }

    locked = false;
  }

  /** 启动定时检测（每1秒检测一次小红点） */
  function startPeriodicCheck() {
    if (checkInterval) {
      clearInterval(checkInterval);
    }
    checkInterval = setInterval(() => {
      if (enabled && !locked) {
        tryAutoReply();
      }
    }, 1000);
    log("⏰ 已启动定时检测（每1秒检测一次小红点）");
  }

  /** 停止定时检测 */
  function stopPeriodicCheck() {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
      log("⏸️ 已停止定时检测");
    }
  }

  // 保留 MutationObserver 作为备用（但降低频率，避免与定时器冲突）
  const observer = new MutationObserver(() => {
    // 定时器已覆盖主要检测，这里只做轻量级触发
    // 不直接调用 tryAutoReply，避免频繁触发
  });

  observer.observe(document.body, { childList: true, subtree: true });
  
  // 启动定时检测
  startPeriodicCheck();
  
  // 页面卸载时清理定时器
  window.addEventListener('beforeunload', () => {
    stopPeriodicCheck();
  });
  
  log("🚀 已注入，定时检测已启动（每1秒检测一次小红点）");
  try { setTimeout(createPanel, 300); } catch (e) {
    window.addEventListener('load', () => setTimeout(createPanel, 600));
  }

  try {
    const wrap = (type) => {
      const orig = history[type];
      history[type] = function() {
        const res = orig.apply(this, arguments);
        window.dispatchEvent(new Event('dy-url-change'));
        return res;
      };
    };
    wrap('pushState');
    wrap('replaceState');
    window.addEventListener('popstate', () => window.dispatchEvent(new Event('dy-url-change')));
    window.addEventListener('dy-url-change', () => {
      log('[DY-HUMAN] URL change detected — re-initializing UI');
      setTimeout(() => { 
        try { createPanel(); } catch(e) {}
        // 定时器会自动检测，这里不需要手动调用 tryAutoReply
      }, 450);
    });
  } catch (e) {}
})();
