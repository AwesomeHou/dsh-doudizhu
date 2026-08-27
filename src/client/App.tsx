/**
 * dsh-doudizhu 客户端主界面（在线 PVP，真人不足时机器人补位）
 * - 侧边栏入口 + 独立斗地主工作区 + 可调整画中画小窗
 * - 大厅：昵称/头像/段位/余额、每日签到、桌别选择、匹配（15s 自动补机器人）
 * - 牌桌（线上 PVP）：叫地主/抢地主 → 出牌/过/提示 → 结算
 * - 经济：服务端权威记账（Cloudflare Worker）
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createElement, Fragment } from 'react'
import { CONFIG, rankForBalance, tableById } from '../../shared/config.ts'
import { cardName, sortHand } from '../../shared/engine/deck.ts'
import { classify, hintPlay } from '../../shared/engine/valid.ts'
import { canBeat } from '../../shared/engine/compare.ts'
import { KIND_NAMES, RANK_NAMES, SUIT_SYMBOLS, type Card, type Role, type Seat } from '../../shared/engine/types.ts'
import { deepseekBlueUrl, deepseekBlackUrl } from './brandAssets.ts'
import { PROTOCOL_VERSION, APP_VERSION } from '../../shared/protocol.ts'
import * as api from './api.ts'
import { tableViewFromProtocol, type TableView, type SeatView } from './table-view.ts'
import { inferAction, snapshotOf, type StateSnapshot } from './action-feedback.ts'

/* ============================== 样式 ============================== */

const STYLE = `
 .ddz-root{--dz-blue:#4d6bfe;--dz-blue-hover:#405de0;--dz-bg:#f5f7fa;--dz-panel:#fff;--dz-surface:#fff;--dz-table:#f7f8fb;--dz-line:#e4e7ed;--dz-text:#20242c;--dz-dim:#6f7684;--dz-red:#c53f4d;--dz-red-soft:#fff0f1;--dz-gold:#966813;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--dz-text);color-scheme:light;}
.ddz-btn{background:var(--dz-blue);border:0;border-radius:9px;color:#fff;font-size:14px;line-height:20px;padding:9px 18px;cursor:pointer;font-weight:650;transition:background-color .18s ease,transform .18s ease,box-shadow .18s ease}
.ddz-btn:hover{background:var(--dz-blue-hover);transform:translateY(-1px)}
.ddz-btn:active{transform:translateY(1px)}
 .ddz-btn:focus-visible,.ddz-tab:focus-visible,.ddz-card:focus-visible{outline:3px solid rgba(77,107,254,.28);outline-offset:2px}
.ddz-btn:disabled{background:#b7becb;cursor:not-allowed}
.ddz-btn-ghost{background:var(--dz-panel);border:1px solid var(--dz-line);color:var(--dz-text)}
.ddz-btn-ghost:hover{background:#f7f8fb;color:var(--dz-text)}
.ddz-btn-red{background:var(--dz-red)}
 .ddz-sidebar-entry-host{position:fixed;z-index:2147483000;pointer-events:none}
 .ddz-sidebar-entry{appearance:none;width:100%;height:100%;display:flex;align-items:center;gap:10px;padding:0 14px;border:1px solid var(--dz-line);border-radius:11px;background:#fff;color:var(--dz-text);font:inherit;font-size:14px;line-height:20px;text-align:left;cursor:pointer;pointer-events:auto;box-sizing:border-box;transition:background-color .18s ease,border-color .18s ease,box-shadow .18s ease}
 .ddz-sidebar-entry:hover{background:#f8f9ff;border-color:#cbd3ea;box-shadow:0 2px 6px rgba(26,32,47,.08)}
 .ddz-sidebar-entry-host.is-active .ddz-sidebar-entry{background:#eef0f3;border-color:#d7dbe3;box-shadow:inset 0 0 0 1px #e2e5ea}
 body[data-dsh-doudizhu-standalone="true"] [role="treeitem"][aria-selected="true"]:not(:hover){background-color:transparent!important;box-shadow:none!important}
 /* 宿主系统级模态（如设置）打开时，斗地主所有浮层下沉到宿主遮罩（z-index:1000）之下，
    入口与侧栏其它按钮一致地变暗且不可点击，避免“依然亮着”盖在设置面板上 */
 .ddz-root[data-host-modal="true"] .ddz-sidebar-entry-host{ z-index:900 }
 .ddz-root[data-host-modal="true"] .ddz-standalone-surface{ z-index:900 }
 .ddz-root[data-host-modal="true"] .ddz-pip-window{ z-index:900 }
 .ddz-root[data-host-modal="true"] .ddz-sidebar-entry{opacity:.45;pointer-events:none;cursor:not-allowed;box-shadow:none}
 .ddz-sidebar-entry:active{background:#f1f3ff}
 .ddz-sidebar-entry:focus-visible{outline:3px solid rgba(77,107,254,.28);outline-offset:2px}
 .ddz-sidebar-entry-icon{width:24px;height:24px;display:grid;place-items:center;flex:0 0 24px;border-radius:7px;background:#eef1ff;color:#304bc5;font-size:15px}
 .ddz-sidebar-entry-copy{display:flex;flex-direction:column;min-width:0;gap:1px}
 .ddz-sidebar-entry-title{font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .ddz-sidebar-entry-subtitle{font-size:11px;line-height:15px;color:var(--dz-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .ddz-sidebar-entry-host.is-compact .ddz-sidebar-entry{justify-content:center;padding:0 6px}
 .ddz-sidebar-entry-host.is-compact .ddz-sidebar-entry-copy{display:none}
 .ddz-standalone-surface{position:fixed;inset:0 0 0 280px;z-index:2147482000;min-width:0;overflow:hidden;background:var(--dz-panel);border-left:1px solid var(--dz-line);animation:ddz-modal-in .24s cubic-bezier(.22,1,.36,1) both}
 .ddz-conversation-page{position:relative;height:100%;min-height:0;background:var(--dz-panel)}
 .ddz-conversation-popout{position:absolute;top:10px;right:18px;z-index:2;appearance:none;border:1px solid var(--dz-line);border-radius:8px;background:#fff;color:var(--dz-dim);padding:6px 9px;font:inherit;font-size:12px;cursor:pointer}
 .ddz-conversation-popout:hover{background:#f2f4f8;color:var(--dz-text)}
 .ddz-conversation-popout:focus-visible{outline:3px solid rgba(77,107,254,.28);outline-offset:2px}
 .ddz-modal{position:relative;background:var(--dz-panel);border-radius:14px;width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden}
 .ddz-pip-window{position:fixed;z-index:2147483647;overflow:hidden;border:1px solid var(--dz-line);border-radius:14px;background:var(--dz-panel);box-shadow:0 14px 34px rgba(26,32,47,.22);animation:ddz-modal-in .24s cubic-bezier(.22,1,.36,1) both}
 .ddz-pip-window .ddz-modal{box-shadow:none;border-radius:0}
 .ddz-pip-toolbar{height:42px;flex:0 0 42px;display:flex;align-items:center;justify-content:space-between;padding:0 10px 0 16px;border-bottom:1px solid var(--dz-line);background:#fff;color:var(--dz-text);font-size:13px;font-weight:700;cursor:move;user-select:none;touch-action:none}
 .ddz-pip-toolbar-actions{display:flex;align-items:center;gap:4px;cursor:default}
 .ddz-pip-toolbar-btn{appearance:none;border:0;border-radius:7px;background:transparent;color:var(--dz-dim);padding:6px 8px;font:inherit;font-size:12px;cursor:pointer}
 .ddz-pip-toolbar-btn:hover{background:#f2f4f8;color:var(--dz-text)}
 .ddz-pip-toolbar-btn:focus-visible{outline:3px solid rgba(77,107,254,.28);outline-offset:2px}
 /* 小窗自适应：内容画布按窗口可用区域等比缩放，不出现滑块；工具栏保持自然尺寸 */
 .ddz-pip-canvas{position:relative;flex:1;min-height:0;overflow:hidden;background:var(--dz-surface)}
 .ddz-pip-scale{position:absolute;top:0;left:0;transform-origin:0 0;width:100%;min-width:max-content;min-height:100%;height:auto;display:flex;flex-direction:column}
 .ddz-pip-window .ddz-body{scrollbar-width:none;-ms-overflow-style:none}
 .ddz-pip-window .ddz-body::-webkit-scrollbar{display:none}
 .ddz-pip-resize-handle{position:absolute;z-index:4;touch-action:none}
 .ddz-pip-resize-handle.is-n,.ddz-pip-resize-handle.is-s{left:12px;right:12px;height:8px;cursor:ns-resize}
 .ddz-pip-resize-handle.is-n{top:0}
 .ddz-pip-resize-handle.is-s{bottom:0}
 .ddz-pip-resize-handle.is-e,.ddz-pip-resize-handle.is-w{top:12px;bottom:12px;width:8px;cursor:ew-resize}
 .ddz-pip-resize-handle.is-e{right:0}
 .ddz-pip-resize-handle.is-w{left:0}
 .ddz-pip-resize-handle.is-ne,.ddz-pip-resize-handle.is-sw{width:14px;height:14px;cursor:nesw-resize}
 .ddz-pip-resize-handle.is-ne{top:0;right:0}
 .ddz-pip-resize-handle.is-sw{left:0;bottom:0}
 .ddz-pip-resize-handle.is-nw,.ddz-pip-resize-handle.is-se{width:14px;height:14px;cursor:nwse-resize}
 .ddz-pip-resize-handle.is-nw{top:0;left:0}
 .ddz-pip-resize-handle.is-se{right:0;bottom:0}
.ddz-corner-close{position:absolute;top:14px;right:16px;z-index:2;width:34px;height:34px;padding:0;border:1px solid transparent;border-radius:50%;background:transparent;color:var(--dz-dim);font-size:22px;line-height:1;cursor:pointer}
.ddz-corner-close:hover{background:#f2f4f8;color:var(--dz-text)}
.ddz-corner-close:focus-visible{outline:3px solid rgba(77,107,254,.28);outline-offset:2px}
.ddz-table-exit{position:absolute;top:16px;left:16px;z-index:2;background:transparent;border:0;color:var(--dz-dim);font:inherit;font-size:13px;cursor:pointer;padding:6px 8px;border-radius:7px}
.ddz-table-exit:hover{background:#f2f4f8;color:var(--dz-text)}
.ddz-table-exit:focus-visible{outline:3px solid rgba(77,107,254,.28);outline-offset:2px}
.ddz-body{flex:1;overflow:auto;padding:24px;background:var(--dz-surface)}
.ddz-row{display:flex;gap:10px;align-items:center}
.ddz-dim{color:var(--dz-dim)}
.ddz-rank{display:inline-block;background:#e9edff;color:#304bc5;border-radius:6px;padding:3px 9px;font-size:12px;font-weight:700}
button.ddz-rank{border:0;cursor:pointer;font-family:inherit;line-height:18px}
button.ddz-rank:hover{background:#dde3ff}
button.ddz-rank:focus-visible{outline:3px solid rgba(77,107,254,.28);outline-offset:2px}
.ddz-card{position:relative;width:44px;height:64px;border-radius:7px;background:#fff;color:#20242c;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;cursor:pointer;user-select:none;border:1px solid #d9dde5;box-shadow:0 1px 3px rgba(26,32,47,.12);transition:transform .14s ease,box-shadow .14s ease}
.ddz-card:hover{transform:translateY(-2px);box-shadow:0 4px 9px rgba(26,32,47,.14)}
.ddz-card.red{color:var(--dz-red)}
.ddz-card.sel{transform:translateY(-14px);box-shadow:0 0 0 2px var(--dz-blue),0 5px 10px rgba(77,107,254,.18)}
.ddz-card-corner{position:absolute;z-index:1;display:flex;flex-direction:column;align-items:center;line-height:.88;font-weight:800;pointer-events:none}
.ddz-card-corner.top{top:5px;left:5px}
.ddz-card-corner.bottom{right:5px;bottom:5px}
.ddz-card-rank{font-size:18px;letter-spacing:-.04em}
.ddz-card-rank.long{font-size:15px;letter-spacing:-.08em}
.ddz-card-suit{font-size:13px;line-height:1}
/* 大王/小王：JOKER 英文竖排（靠左、字母紧凑不分散），大王红、小王黑；
   box-sizing:border-box 保证 padding 不把牌撑大（与其它牌同尺寸） */
.ddz-joker-card{box-sizing:border-box;justify-content:flex-start;align-items:flex-start;padding:6px}
.ddz-joker-main{display:flex;flex-direction:column;align-items:center;gap:0;font-weight:900;line-height:.92;font-size:10px;letter-spacing:0}
.ddz-joker-letter{display:block;line-height:.92}
.ddz-joker-card.ddz-card-big .ddz-joker-main{font-size:13px}
.ddz-joker-card.ddz-card-mini .ddz-joker-main{font-size:6px}
/* 自己的手牌放大 */
.ddz-card-big{width:56px;height:80px;border-radius:9px;font-size:24px}
.ddz-card-big .ddz-card-rank{font-size:22px}
.ddz-card-big .ddz-card-rank.long{font-size:17px;letter-spacing:-.06em}
.ddz-card-big .ddz-card-suit{font-size:16px}
.ddz-card-big .ddz-card-corner.top{top:6px;left:6px}
.ddz-card-big .ddz-card-corner.bottom{right:6px;bottom:6px}
.ddz-card-big:hover{transform:translateY(-3px);box-shadow:0 4px 9px rgba(26,32,47,.14)}
.ddz-card-big.sel{transform:translateY(-18px)}
.ddz-card-big.sel:hover{transform:translateY(-18px);box-shadow:0 0 0 2px var(--dz-blue),0 5px 10px rgba(77,107,254,.18)}
.ddz-human-hand .ddz-card-stack-item:not(:first-child){margin-left:-32px}
/* 明牌展示用的小牌（只保留左上角点数+花色） */
.ddz-card-mini{width:26px;height:38px;border-radius:5px;font-size:13px}
.ddz-card-mini .ddz-card-rank{font-size:10px}
.ddz-card-mini .ddz-card-rank.long{font-size:8px;letter-spacing:-.05em}
.ddz-card-mini .ddz-card-suit{font-size:8px}
.ddz-card-mini .ddz-card-corner.top{top:3px;left:3px}
.ddz-revealed-row{display:flex;flex-wrap:wrap;justify-content:center;gap:0;max-width:220px}
.ddz-revealed-card{flex:0 0 auto}
.ddz-revealed-card:not(:first-child){margin-left:-13px}
.ddz-revealed-card .ddz-card{cursor:default}
.ddz-revealed-card .ddz-card:hover{transform:none;box-shadow:0 1px 3px rgba(26,32,47,.12)}
/* 发牌完成后的整理动画 */
.ddz-hand-arranging .ddz-hand-card{animation:ddz-arrange-in .4s cubic-bezier(.22,1,.36,1) both}
@keyframes ddz-arrange-in{0%{transform:translateY(9px) scale(.95)}60%{transform:translateY(-2px) scale(1.015)}100%{transform:none}}
/* 超级加倍按钮 */
.ddz-btn-gold{background:var(--dz-gold)}
.ddz-btn-gold:hover{background:#7d540f}
/* 直接进入机器人对局按钮 */
.ddz-btn-bot{background:#2f9e62}
.ddz-btn-bot:hover{background:#26834f}
.ddz-card-back{cursor:default;background:#f3f5fa;color:transparent}
.ddz-card-back:hover{transform:none;box-shadow:0 1px 3px rgba(26,32,47,.12)}
.ddz-card-back img{width:72%;height:72%;object-fit:contain;opacity:.78}
.ddz-seat{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:144px}
.ddz-avatar{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#f2f4f8;border:1px solid var(--dz-line);overflow:hidden}
.ddz-avatar.blue{background:#eef1ff}
.ddz-avatar.black{background:#f0f1f4}
.ddz-avatar img{width:74%;height:74%;object-fit:contain;display:block}
.ddz-table{position:relative;flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:18px;background:var(--dz-table);border:1px solid var(--dz-line);border-radius:12px}
.ddz-turn{color:#304bc5;font-weight:700}
.ddz-bottom{margin-top:6px;min-height:56px;display:flex;align-items:center;gap:6px}
.ddz-settle{text-align:center}
.ddz-big{font-size:26px;font-weight:800}
.ddz-input{background:#fff;border:1px solid var(--dz-line);border-radius:8px;color:var(--dz-text);padding:8px 10px;font-size:14px;width:200px}
.ddz-tab{appearance:none;background:#fff;border:1px solid var(--dz-line);color:var(--dz-text);border-radius:10px;padding:14px;cursor:pointer;text-align:left;min-width:0;flex:1;font:inherit}
.ddz-tab:hover{background:#fafbff;border-color:#cbd3ea}
.ddz-tab.on{border-color:var(--dz-blue);box-shadow:0 0 0 1px var(--dz-blue);background:#fbfcff}
.ddz-toast{position:fixed;left:50%;top:20px;transform:translateX(-50%);background:#fff;color:var(--dz-text);border:1px solid var(--dz-blue);border-radius:10px;padding:10px 18px;font-size:14px;z-index:2147483001;box-shadow:0 8px 12px rgba(26,32,47,.14);animation:ddz-toast-life 2.6s cubic-bezier(.22,1,.36,1) both}
.ddz-lobby{padding:30px 36px 36px}
.ddz-lobby-top{display:flex;justify-content:flex-start;align-items:flex-start;gap:24px;margin-bottom:46px}
.ddz-lobby-profile-stack{display:flex;flex-direction:column;align-items:flex-start;gap:18px}
.ddz-profile{gap:12px}
.ddz-avatar-picker-anchor{position:relative;display:flex}
.ddz-avatar-button{appearance:none;padding:0;border:0;background:transparent;border-radius:50%;display:inline-flex;cursor:pointer}
.ddz-avatar-button:hover .ddz-avatar{box-shadow:0 0 0 3px rgba(77,107,254,.12)}
.ddz-avatar-button:focus-visible,.ddz-icon-btn:focus-visible,.ddz-avatar-option:focus-visible{outline:3px solid rgba(77,107,254,.28);outline-offset:2px}
.ddz-avatar-picker{position:absolute;top:calc(100% + 10px);left:0;z-index:4;min-width:168px;padding:10px;border:1px solid var(--dz-line);border-radius:12px;background:#fff;box-shadow:0 10px 24px rgba(26,32,47,.14);animation:ddz-picker-in .18s cubic-bezier(.22,1,.36,1) both}
.ddz-avatar-picker-title{margin:0 0 8px;padding:0 2px;color:var(--dz-dim);font-size:11px}
.ddz-avatar-options{display:flex;gap:8px}
.ddz-avatar-option{appearance:none;display:flex;flex-direction:column;align-items:center;gap:5px;padding:6px;border:1px solid transparent;border-radius:9px;background:#fff;color:var(--dz-dim);font:inherit;font-size:10px;cursor:pointer}
.ddz-avatar-option:hover{background:#f7f8ff;border-color:#cbd5ff}
.ddz-avatar-option.selected{border-color:var(--dz-blue);background:#f7f8ff;color:#304bc5;box-shadow:0 0 0 1px var(--dz-blue)}
.ddz-profile-copy{display:flex;flex-direction:column;gap:2px}
.ddz-profile-name-row{display:flex;align-items:center;gap:4px}
.ddz-profile-name{font-size:15px;font-weight:700}
.ddz-icon-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dz-dim);cursor:pointer}
.ddz-icon-btn:hover{background:#f2f4f8;color:var(--dz-text)}
.ddz-icon-btn svg{width:14px;height:14px;display:block}
.ddz-nickname-editor{display:flex;align-items:center;gap:5px}
.ddz-nickname-input{width:150px;min-width:0;padding:5px 7px;border:1px solid var(--dz-blue);border-radius:6px;color:var(--dz-text);font:inherit;font-size:13px;outline:0}
.ddz-nickname-editor .ddz-icon-btn{width:22px;height:22px}
.ddz-profile-uid{font-size:12px}
.ddz-balance{gap:14px}
.ddz-balance-copy{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.ddz-lobby .ddz-balance-copy{align-items:flex-start}
.ddz-balance-label{font-size:12px;color:var(--dz-dim)}
.ddz-balance-value{font-size:20px;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.ddz-lobby-intro{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.ddz-section-title{font-size:16px;font-weight:700;letter-spacing:-.01em}
.ddz-lobby-subtitle{font-size:13px}
.ddz-table-grid{display:flex;gap:12px;align-items:stretch}
.ddz-table-grid .ddz-tab{min-height:92px}
.ddz-table-grid .ddz-tab>div:first-child{font-size:15px;margin-bottom:6px}
.ddz-lobby-actions{display:flex;align-items:center;gap:10px;margin-top:22px}
.ddz-helper{font-size:12px;margin-top:10px}
.ddz-lobby-connect{display:flex;align-items:center;gap:4px;font-size:13px;margin-top:4px}
.ddz-table-screen{display:flex;flex-direction:column}
.ddz-table-reserved-bar{height:44px;flex:0 0 44px;visibility:hidden}
.ddz-game-table{min-height:0;gap:14px;padding:24px;background:#fbfcfd;border-color:#edf0f4;border-radius:18px}
.ddz-top-reveal{display:flex;justify-content:center;align-items:center;min-height:88px}
.ddz-reveal-cards{display:flex;align-items:center;gap:6px;padding:10px 12px;border:1px solid #cbd5ff;border-radius:12px;background:#f7f8ff}
.ddz-reveal-card,.ddz-played-card{display:flex}
.ddz-reveal-card{animation:ddz-reveal-in .34s cubic-bezier(.22,1,.36,1);animation-delay:var(--ddz-delay,0ms);animation-fill-mode:both}
.ddz-reveal-cards.is-revealed{perspective:600px;animation:ddz-landlord-reveal .42s cubic-bezier(.22,1,.36,1) both}
.ddz-reveal-cards.is-revealed .ddz-reveal-card{animation-name:ddz-landlord-card-reveal;animation-duration:.46s;transform-origin:center;backface-visibility:hidden}
.ddz-played-card{animation:ddz-played-in .24s cubic-bezier(.22,1,.36,1);animation-delay:var(--ddz-delay,0ms);animation-fill-mode:both}
.ddz-hand-card{display:flex;animation:ddz-deal-in .36s cubic-bezier(.22,1,.36,1);animation-delay:var(--ddz-delay,0ms);animation-fill-mode:both}
.ddz-reveal-back-set{background:#f6f7fb}
.ddz-table-middle{display:grid;grid-template-columns:minmax(280px,1fr) minmax(140px,.6fr) minmax(280px,1fr);align-items:center;gap:18px;flex:1}
.ddz-side-zone{display:grid;align-items:center;gap:18px;min-width:0}
.ddz-side-zone.left{grid-template-columns:auto minmax(120px,1fr)}
.ddz-side-zone.right{grid-template-columns:minmax(120px,1fr) auto}
.ddz-play-area{position:relative;min-width:0;min-height:96px;width:100%;display:flex;align-items:center;justify-content:center;border:1px solid #e8ebf2;border-radius:14px;background:rgba(255,255,255,.48)}
.ddz-play-area-cards{display:flex;align-items:center;justify-content:center;gap:0;flex-wrap:nowrap}
.ddz-play-area-countdown{position:absolute;top:8px;right:8px}
.ddz-special-play{position:relative;animation:ddz-special-play-in .55s cubic-bezier(.22,1,.36,1) both}
.ddz-special-bomb{animation-name:ddz-bomb-burst}
.ddz-special-rocket{animation-name:ddz-rocket-burst}
.ddz-special-bomb .ddz-card,.ddz-special-rocket .ddz-card{border-color:#e4c56d;box-shadow:0 0 0 2px rgba(150,104,19,.12),0 6px 14px rgba(150,104,19,.18)}
.ddz-special-label{position:absolute;left:8px;bottom:8px;z-index:2;padding:3px 7px;border-radius:999px;background:#fff;color:var(--dz-gold);border:1px solid #ecd798;font-size:10px;font-weight:800;line-height:14px;box-shadow:0 2px 5px rgba(26,32,47,.1);animation:ddz-special-label-in .3s .08s both}
.ddz-special-label-rocket{background:#eef1ff;color:#304bc5;border-color:#cbd5ff}
.ddz-folded-cards .ddz-card-stack-item{position:relative;flex:0 0 auto}
.ddz-folded-cards .ddz-card-stack-item:not(:first-child){margin-left:-24px}
.ddz-hand.ddz-folded-cards{flex-wrap:nowrap;gap:0}
.ddz-play-area .ddz-card{cursor:default}
.ddz-play-area .ddz-card:hover{transform:none;box-shadow:0 1px 3px rgba(26,32,47,.12)}
.ddz-table-center{min-height:188px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}
.ddz-table-turn-label{font-size:13px;color:var(--dz-dim);min-height:20px}
.ddz-human-area{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}
.ddz-human-area .ddz-play-area{width:min(560px,100%)}
.ddz-human-area .ddz-play-area{order:1}
.ddz-hand{display:flex;justify-content:center;flex-wrap:wrap;gap:4px;padding:2px 0}
.ddz-action-dock{position:relative;display:flex;justify-content:center;gap:10px;min-height:40px}
.ddz-human-area .ddz-action-dock{order:2}
.ddz-human-area .ddz-hand{order:3}
.ddz-action-hint{position:relative;display:flex}
.ddz-action-bubble{position:absolute;left:50%;bottom:calc(100% + 10px);z-index:3;transform:translateX(-50%);padding:8px 12px;border:1px solid var(--dz-blue);border-radius:10px;background:#fff;color:var(--dz-text);box-shadow:0 8px 12px rgba(26,32,47,.14);font-size:13px;line-height:18px;white-space:nowrap;animation:ddz-toast-in .22s cubic-bezier(.22,1,.36,1) both}
.ddz-action-bubble::after{content:'';position:absolute;left:50%;bottom:-6px;width:10px;height:10px;background:#fff;border-right:1px solid var(--dz-blue);border-bottom:1px solid var(--dz-blue);transform:translateX(-50%) rotate(45deg)}
.ddz-action-countdown{min-width:34px;justify-content:center;align-self:center}
/* 角色行动反馈（叫地主/抢地主/不抢/过）：以直接文本形式出现在出牌区内，与出牌同性质；
   叫/抢 使用主色高权重，放弃/过 使用次级灰色，与出牌区内其它文本形成层级关系 */
.ddz-play-area-action{position:absolute;left:50%;top:50%;z-index:3;transform:translate(-50%,-50%);font-size:22px;font-weight:800;letter-spacing:.04em;color:#304bc5;line-height:1.2;white-space:nowrap;pointer-events:none;animation:ddz-action-text-in .3s cubic-bezier(.22,1,.36,1) both;text-shadow:0 1px 0 #fff,0 2px 6px rgba(26,32,47,.12)}
.ddz-play-area-action.is-pass{color:var(--dz-dim);font-size:18px;font-weight:700}
.ddz-human-hand-row{position:relative;display:flex;align-items:flex-end;justify-content:center;gap:16px;width:100%;min-width:0}
.ddz-human-area .ddz-human-hand-row{order:3}
.ddz-human-hand{width:100%;min-width:0;flex:none;justify-content:center}
.ddz-human-hand-row .ddz-seat{position:absolute;left:0;bottom:0}
.ddz-action-dock.is-active{animation:ddz-action-ready .24s cubic-bezier(.22,1,.36,1) both}
.ddz-action-status{font-size:13px;padding:10px 14px;border-radius:999px;background:#fff;border:1px solid var(--dz-line)}
.ddz-countdown{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;background:#fff4e8;color:#a44e10;font-size:11px;font-weight:750;font-variant-numeric:tabular-nums}
.ddz-countdown.urgent{background:#fff0f1;color:var(--dz-red);animation:ddz-countdown-pulse .8s ease-in-out infinite}
.ddz-role-badge{display:inline-flex;align-items:center;border-radius:5px;padding:2px 7px;font-size:11px;font-weight:700}
.ddz-landlord-badge{background:var(--dz-red-soft);color:var(--dz-red)}
.ddz-farmer-badge{background:#e9edff;color:#304bc5}
.ddz-settle{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:100%}
.ddz-result-amount{font-size:32px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.03em;margin:8px 0}
.ddz-seat{gap:8px}
.ddz-seat-identity{position:relative}
.ddz-seat-rank{position:absolute;top:-11px;left:24px;z-index:1;display:inline-flex;align-items:center;max-width:74px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#e9edff;color:#304bc5;border-radius:999px;padding:1px 5px;font-size:9px;line-height:13px;font-weight:750;transform:translateX(-50%)}
.ddz-seat-chip{display:flex;align-items:center;gap:9px;padding:6px 12px 6px 6px;border:1px solid var(--dz-line);border-radius:999px;background:rgba(255,255,255,.86);box-shadow:0 2px 6px rgba(26,32,47,.08)}
.ddz-seat-chip.is-turn{border-color:#cbd5ff;animation:ddz-turn-pulse 1.8s ease-in-out infinite}
.ddz-seat-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.ddz-seat-name{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;white-space:nowrap}
.ddz-seat-meta{font-size:10px;color:var(--dz-dim);white-space:nowrap}
.ddz-seat-cards{font-size:11px;color:var(--dz-dim)}
.ddz-card-count{display:inline-block;padding:3px 8px;border-radius:999px;background:#eef1f6}
.ddz-multiplier{display:inline-block;padding:3px 8px;border-radius:999px;background:#fff7e6;color:var(--dz-gold);font-weight:750;font-variant-numeric:tabular-nums}
.ddz-latency{flex:0 0 auto;display:flex;align-items:center;justify-content:center;gap:6px;padding:6px 12px;border-top:1px solid var(--dz-line);background:var(--dz-surface);color:var(--dz-dim);font-size:12px}
.ddz-latency .ddz-latency-dot{width:8px;height:8px;border-radius:50%;background:#b7becb;display:inline-block}
.ddz-latency.good .ddz-latency-dot{background:#2f9e62}
.ddz-latency.mid .ddz-latency-dot{background:#e6a23c}
.ddz-latency.bad .ddz-latency-dot{background:var(--dz-red)}
.ddz-latency b{font-variant-numeric:tabular-nums;color:var(--dz-text);font-weight:700}
.ddz-latency-sep{margin:0 2px;opacity:.5}
.ddz-lobby-version{flex:0 0 auto;text-align:center;padding:8px 0 2px;font-size:11px;color:var(--dz-dim)}
.ddz-disclaimer{flex:0 0 auto;text-align:center;padding:2px 8px 6px;font-size:11px;color:var(--dz-dim)}
.ddz-lobby-latency{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--dz-dim);margin-top:8px}
.ddz-lobby-latency .ddz-latency-dot{width:8px;height:8px}
.ddz-lobby-latency.good .ddz-latency-dot{background:#2f9e62}
.ddz-lobby-latency.mid .ddz-latency-dot{background:#e6a23c}
.ddz-lobby-latency.bad .ddz-latency-dot{background:var(--dz-red)}
.ddz-lobby-latency b{font-variant-numeric:tabular-nums;color:var(--dz-text)}
.ddz-dialog{position:fixed;inset:0;z-index:2147483000;background:rgba(28,32,42,.5);display:flex;align-items:center;justify-content:center;animation:ddz-overlay-in .2s ease-out both}
.ddz-dialog-card{width:min(430px,92vw);background:var(--dz-panel);border:1px solid var(--dz-line);border-radius:16px;padding:22px;box-shadow:0 18px 42px rgba(26,32,47,.25)}
.ddz-dialog-title{font-size:17px;font-weight:800;margin:0 0 10px}
.ddz-dialog-body{font-size:13px;line-height:1.7;color:var(--dz-dim);margin-bottom:16px}
.ddz-dialog-code{display:block;background:#f2f4f8;border:1px solid var(--dz-line);border-radius:8px;padding:8px 10px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dz-text);margin:8px 0 2px;word-break:break-all}
.ddz-rank-table{display:flex;flex-direction:column;gap:8px;margin-top:2px}
.ddz-rank-row{display:flex;flex-direction:column;gap:3px;padding:9px 12px;border:1px solid var(--dz-line);border-radius:10px;background:#fbfcff}
.ddz-rank-row.is-current{border-color:var(--dz-blue);box-shadow:0 0 0 1px var(--dz-blue);background:#f5f7ff}
.ddz-rank-row-top{display:flex;align-items:center;gap:8px}
.ddz-rank-row-name{font-size:13px;font-weight:750;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.ddz-rank-row-current{font-size:10px;font-weight:700;color:#fff;background:var(--dz-blue);border-radius:999px;padding:1px 6px}
.ddz-rank-row-range{margin-left:auto;font-size:11px;color:var(--dz-dim);font-variant-numeric:tabular-nums;white-space:nowrap}
 @keyframes ddz-overlay-in{from{opacity:0}to{opacity:1}}
 @keyframes ddz-modal-in{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
@keyframes ddz-toast-in{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes ddz-action-text-in{from{opacity:0;transform:translate(-50%,calc(-50% + 8px)) scale(.9)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
/* 反馈气泡生命周期：快速进入 → 停留 → 末尾淡出（2.6s 后由 JS 移除 DOM） */
@keyframes ddz-toast-life{0%{opacity:0;transform:translate(-50%,-6px)}8%{opacity:1;transform:translate(-50%,0)}82%{opacity:1}100%{opacity:0}}
@keyframes ddz-picker-in{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
@keyframes ddz-reveal-in{from{opacity:0;transform:translateY(-8px) scale(.94)}to{opacity:1;transform:none}}
@keyframes ddz-landlord-reveal{from{opacity:.72;transform:translateY(-5px) scale(.97);box-shadow:0 0 0 0 rgba(77,107,254,0)}50%{box-shadow:0 0 0 5px rgba(77,107,254,.12)}to{opacity:1;transform:none;box-shadow:none}}
@keyframes ddz-landlord-card-reveal{from{opacity:0;transform:rotateY(90deg) translateY(-4px) scale(.9)}to{opacity:1;transform:none}}
@keyframes ddz-played-in{from{opacity:0;transform:translateY(8px) scale(.94)}to{opacity:1;transform:none}}
@keyframes ddz-deal-in{from{opacity:0;transform:translateY(-18px) rotate(-3deg) scale(.92)}to{opacity:1;transform:none}}
@keyframes ddz-special-play-in{from{opacity:0;transform:translateY(10px) scale(.82);filter:drop-shadow(0 0 0 rgba(197,63,77,0))}45%{opacity:1;transform:translateY(-4px) scale(1.04);filter:drop-shadow(0 5px 10px rgba(197,63,77,.18))}to{opacity:1;transform:none;filter:none}}
@keyframes ddz-bomb-burst{from{opacity:0;transform:translateY(10px) scale(.82);filter:drop-shadow(0 0 0 rgba(150,104,19,0))}35%{opacity:1;transform:translateY(-5px) scale(1.07);filter:drop-shadow(0 0 9px rgba(150,104,19,.45))}62%{transform:translateY(1px) scale(.98);filter:drop-shadow(0 0 4px rgba(150,104,19,.22))}to{opacity:1;transform:none;filter:none}}
@keyframes ddz-rocket-burst{from{opacity:0;transform:translateY(10px) scale(.82);filter:drop-shadow(0 0 0 rgba(77,107,254,0))}35%{opacity:1;transform:translateY(-6px) scale(1.08);filter:drop-shadow(0 0 11px rgba(77,107,254,.48))}65%{transform:translateY(1px) scale(.98);filter:drop-shadow(0 0 5px rgba(77,107,254,.24))}to{opacity:1;transform:none;filter:none}}
@keyframes ddz-special-label-in{from{opacity:0;transform:translateY(4px) scale(.9)}to{opacity:1;transform:none}}
@keyframes ddz-action-ready{from{opacity:.6;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes ddz-turn-pulse{0%,100%{box-shadow:0 2px 6px rgba(26,32,47,.08)}50%{box-shadow:0 0 0 3px rgba(77,107,254,.12),0 3px 8px rgba(77,107,254,.16)}}
@keyframes ddz-countdown-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
 @media (max-width:720px){.ddz-body{padding:16px}.ddz-corner-close{top:10px;right:12px}.ddz-table-exit{top:10px;left:12px}.ddz-table-reserved-bar{height:36px;flex-basis:36px}.ddz-lobby{padding:20px 16px 24px}.ddz-lobby-top{align-items:flex-start;flex-direction:column;margin-bottom:32px}.ddz-balance{width:auto;justify-content:flex-start}.ddz-balance-copy{align-items:flex-start}.ddz-table-grid{flex-direction:column}.ddz-table-grid .ddz-tab{flex-basis:auto}.ddz-top-reveal{min-height:64px}.ddz-table-middle{grid-template-columns:1fr 1.2fr 1fr;gap:6px}.ddz-side-zone{display:flex;flex-direction:column;gap:8px}.ddz-side-zone .ddz-play-area{min-height:72px}.ddz-table-center{min-height:110px;order:0}.ddz-seat{min-width:0}.ddz-card{width:38px;height:56px;font-size:18px}.ddz-card-big{width:46px;height:66px;font-size:20px}.ddz-card-big .ddz-card-rank{font-size:18px}.ddz-card-big .ddz-card-rank.long{font-size:15px}.ddz-card-big .ddz-card-suit{font-size:13px}.ddz-card-big .ddz-card-corner.top{top:5px;left:5px}.ddz-card-big .ddz-card-corner.bottom{right:5px;bottom:5px}.ddz-joker-card.ddz-card-big .ddz-joker-main{font-size:11px}.ddz-card-mini{width:22px;height:32px;font-size:11px}.ddz-card-mini .ddz-card-rank{font-size:10px}.ddz-card-mini .ddz-card-rank.long{font-size:8px}.ddz-card-mini .ddz-card-suit{font-size:8px}.ddz-joker-card.ddz-card-mini .ddz-joker-main{font-size:5px}.ddz-human-hand .ddz-card-stack-item:not(:first-child){margin-left:-25px}.ddz-table{padding:12px}.ddz-human-hand-row{flex-direction:column;align-items:center;gap:12px}.ddz-human-hand-row .ddz-seat{position:static}.ddz-human-hand{width:100%;flex:none;overflow-x:auto;justify-content:flex-start}}
 @media (prefers-reduced-motion:reduce){.ddz-btn,.ddz-sidebar-entry,.ddz-card{transition:none}.ddz-card:hover{transform:none}.ddz-card.sel{transform:translateY(-8px)}.ddz-pip-window,.ddz-modal,.ddz-toast,.ddz-avatar-picker,.ddz-reveal-card,.ddz-played-card,.ddz-hand-card,.ddz-action-dock.is-active,.ddz-seat-chip.is-turn,.ddz-countdown.urgent,.ddz-special-play,.ddz-special-label,.ddz-hand-arranging .ddz-hand-card{animation:none!important}}
`

/* ============================== 基础组件 ============================== */

function CardView({ card, selected, onClick, size = 'normal' }: { card: Card; selected?: boolean; onClick?: () => void; size?: 'normal' | 'big' | 'mini' }) {
  const isJoker = card.r >= 13
  // 大王红、小王黑；普通牌红桃/方块红
  const isRed = isJoker ? card.r === 14 : card.s === 1 || card.s === 2
  const label = cardName(card)
  const sizeClass = size === 'big' ? ' ddz-card-big' : size === 'mini' ? ' ddz-card-mini' : ''
  if (isJoker) {
    // 大王/小王：英文 JOKER 竖排（只保留中央一列，字号收缩到完整落在牌面内），大王红色、小王黑色
    const letters = 'JOKER'.split('')
    return createElement('div', {
      className: 'ddz-card ddz-joker-card' + (isRed ? ' red' : '') + (selected ? ' sel' : '') + sizeClass,
      role: onClick ? 'button' : undefined,
      tabIndex: onClick ? 0 : undefined,
      'aria-label': onClick ? `选择${label}` : undefined,
      'aria-pressed': onClick ? selected : undefined,
      onClick,
      onKeyDown: onClick ? (event: { key: string }) => {
        if (event.key === 'Enter' || event.key === ' ') onClick()
      } : undefined,
    },
    createElement('span', { className: 'ddz-joker-main', 'aria-label': label },
      ...letters.map((ch, i) => createElement('span', { key: i, className: 'ddz-joker-letter' }, ch))),
    )
  }
  const rank = RANK_NAMES[card.r]!
  const suit = SUIT_SYMBOLS[card.s]!
  const rankClass = rank.length > 1 ? ' long' : ''
  return createElement('div', {
    className: 'ddz-card' + (isRed ? ' red' : '') + (selected ? ' sel' : '') + sizeClass,
    role: onClick ? 'button' : undefined,
    tabIndex: onClick ? 0 : undefined,
    'aria-label': onClick ? `选择${label}` : undefined,
    'aria-pressed': onClick ? selected : undefined,
    onClick,
    onKeyDown: onClick ? (event: { key: string }) => {
      if (event.key === 'Enter' || event.key === ' ') onClick()
    } : undefined,
  },
  createElement('span', { className: 'ddz-card-corner top' },
    createElement('span', { className: 'ddz-card-rank' + rankClass }, rank),
    createElement('span', { className: 'ddz-card-suit' }, suit),
  ),
  // 迷你小牌（明牌展示）只保留左上角，避免左右两角同时露花色看着像两种花色
  size !== 'mini' && createElement('span', { className: 'ddz-card-corner bottom', 'aria-hidden': true },
    createElement('span', { className: 'ddz-card-suit' }, suit),
  ),
  )
}

function CardBack({ label = '未揭示底牌' }: { label?: string }) {
  return createElement('div', { className: 'ddz-card ddz-card-back', role: 'img', 'aria-label': label },
    createElement('img', { src: deepseekBlackUrl, alt: '' }),
  )
}

function Avatar({ avatarId, size = 40 }: { avatarId: string; size?: number }) {
  const blue = avatarId === 'default-01' || avatarId === 'default-01.svg'
  const cls = blue ? 'blue' : 'black'
  const src = blue ? deepseekBlueUrl : deepseekBlackUrl
  return createElement('div', { className: `ddz-avatar ${cls}`, style: { width: size, height: size } },
    createElement('img', { src, alt: '', draggable: false }),
  )
}

function EditIcon() {
  return createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    createElement('path', { d: 'M12 20h9' }),
    createElement('path', { d: 'M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z' }),
  )
}

function CheckIcon() {
  return createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    createElement('path', { d: 'm5 12 4 4L19 6' }),
  )
}

function CloseIcon() {
  return createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', 'aria-hidden': true },
    createElement('path', { d: 'M6 6l12 12M18 6 6 18' }),
  )
}

function formatTokenCount(value: number): string {
  const abs = Math.abs(value)
  const unit = abs >= 1_000_000_000 ? 'B' : abs >= 1_000_000 ? 'M' : abs >= 1_000 ? 'k' : ''
  const divisor = unit === 'B' ? 1_000_000_000 : unit === 'M' ? 1_000_000 : unit === 'k' ? 1_000 : 1
  const amount = value / divisor
  if (!unit) return String(Math.round(value))
  return `${amount.toFixed(amount >= 100 ? 0 : 1).replace(/\.0$/, '')}${unit}`
}

function PlayerRank({ tokenBalance }: { tokenBalance: number }) {
  return createElement('div', { className: 'ddz-seat-rank' }, rankForBalance(tokenBalance).name)
}

function RoleBadge({ role }: { role: Role }) {
  const landlord = role === 'landlord'
  return createElement('span', {
    className: 'ddz-role-badge ' + (landlord ? 'ddz-landlord-badge' : 'ddz-farmer-badge'),
  }, landlord ? '地主' : '农民')
}

function PlayedArea({ seat, humanSeat = 0, cards, countdownSeconds = null, action = null }: { seat: Seat; humanSeat?: Seat; cards: Card[] | null; countdownSeconds?: number | null; action?: { text: string; id: number } | null }) {
  const cardKey = cards?.map((card) => `${card.r}-${card.s}`).join('|') ?? 'empty'
  const play = cards ? classify(cards) : null
  const isSpecialPlay = play !== null && !['single', 'pair', 'triple'].includes(play.kind)
  const specialClass = isSpecialPlay && play ? ` ddz-special-play ddz-special-${play.kind}` : ''
  // 行动反馈文本的层级：叫/抢/加倍/明牌 用主色高权重，放弃/过 用次级灰
  const actionClass = action
    ? (action.text === '叫地主' || action.text === '抢地主' || action.text === '加倍' || action.text === '超级加倍' || action.text === '明牌' ? '' : ' is-pass')
    : ''
  return createElement('div', {
    className: 'ddz-play-area',
    'aria-label': `${seatLabel(seat, humanSeat)}出牌区${play ? `，${KIND_NAMES[play.kind]}` : ''}`,
  },
  action && createElement('div', {
    key: action.id,
    className: 'ddz-play-area-action' + actionClass,
    role: 'status',
    'aria-live': 'polite',
  }, action.text),
  countdownSeconds !== null && createElement('span', {
    className: 'ddz-countdown ddz-play-area-countdown' + (countdownSeconds <= 3 ? ' urgent' : ''),
    'aria-live': 'polite',
  }, `${countdownSeconds}s`),
  cards && cards.length > 0
    ? createElement('div', { className: 'ddz-play-area-cards ddz-folded-cards' + specialClass, key: cardKey },
        ...cards.map((card, i) => createElement('div', {
          key: `${card.r}-${card.s}-${i}`,
          className: 'ddz-played-card ddz-card-stack-item',
          style: { '--ddz-delay': `${i * 35}ms` },
        }, createElement(CardView, { card }))),
      )
    : null,
  isSpecialPlay && play && createElement('span', {
    className: 'ddz-special-label ddz-special-label-' + play.kind,
    key: `special-${cardKey}`,
  }, KIND_NAMES[play.kind]),
  )
}

function seatLabel(seat: Seat, humanSeat: Seat): string {
  if (seat === humanSeat) return '你'
  // 逆时针出牌：下家（下一手行动者）=(humanSeat+1)%3，上家（上一手行动者）=(humanSeat+2)%3
  return seat === ((humanSeat + 1) % 3) as Seat ? '下家' : '上家'
}

/* ============================== 牌桌外壳（本地/线上共用） ============================== */

type PlayedBySeat = [Card[] | null, Card[] | null, Card[] | null]

function GameTableShell(props: {
  view: TableView
  selected: Card[]
  notice: string | null
  remainingSeconds: number | null
  onToggleCard: (c: Card) => void
  onPlay: () => void
  onPass: () => void
  onHint: () => void
  onCall: (call: boolean) => void
  onDouble: (choice: 0 | 1 | 2) => void
  onMing: () => void
  callAnnouncement: string | null
  onExit: () => void
  onDismissNotice: () => void
}) {
  const { view, selected, notice, remainingSeconds, onToggleCard, onPlay, onPass, onHint, onCall, onDouble, onMing, callAnnouncement, onExit, onDismissNotice } = props
  const [playedBySeat, setPlayedBySeat] = useState<PlayedBySeat>(() => [null, null, null])

  // —— 发牌完成 → 手牌“整理”动画（一次短促的落定动效） ——
  const [arranging, setArranging] = useState(false)
  const prevPhaseRef = useRef<TableView['phase'] | null>(null)
  useEffect(() => {
    const prev = prevPhaseRef.current
    prevPhaseRef.current = view.phase
    // 抢地主/加倍环节结束 → 自动清空所有人面前的出牌框（行动文本 + 已出牌）
    if ((prev === 'robbing' && view.phase === 'doubling') || (prev === 'doubling' && view.phase === 'playing')) {
      setActionText({} as Record<Seat, string | null>)
      setPlayedBySeat([null, null, null])
    }
    if (prev === 'dealing' && view.phase !== 'dealing' && view.phase !== 'settled') {
      setArranging(true)
      const t = window.setTimeout(() => setArranging(false), 700)
      return () => window.clearTimeout(t)
    }
  }, [view.phase])

  // —— 角色行动反馈（叫地主/抢地主/加倍/过等）：以文本形式显示在各自出牌区内，与出牌同性质 ——
  // 本地不直接从协议拿到“谁刚做了什么”，靠服务端状态推进（callActor/robActor/doublingActor/
  // current/lastActor 的 diff）推断，并写入各出牌区。
  // 行动文本与出牌一样持久显示（不自动消失）：轮到某座位时清空该座位出牌框（“过”轮到自己才消失），
  // 出牌阶段首次落牌时清空叫牌遗留文本，新一轮对局开始（重开）时清空上一轮文本。
  const [actionText, setActionText] = useState<Record<Seat, string | null>>({} as Record<Seat, string | null>)
  const actionKeyRef = useRef<Record<number, number>>({})
  const lastShownRef = useRef<Record<number, { text: string; at: number }>>({})
  const prevSnapshotRef = useRef<StateSnapshot | null>(null)
  const callingClearedRef = useRef(false)

  const showAction = useCallback((seat: Seat, text: string) => {
    const now = Date.now()
    const last = lastShownRef.current[seat]
    // 乐观反馈与服务端回包重复展示时去重（同座同文案 800ms 内只更新一次）
    if (last && last.text === text && now - last.at < 800) return
    lastShownRef.current[seat] = { text, at: now }
    actionKeyRef.current[seat] = now + Math.random()
    setActionText((prev) => (prev[seat] === text ? prev : { ...prev, [seat]: text }))
  }, [])

  // 清空某座位的出牌框（过牌时让“过”独占出牌框，与出牌同性质）
  const clearSeatCards = useCallback((seat: Seat) => {
    setPlayedBySeat((prev) => {
      if (prev[seat] === null) return prev
      const next = [...prev] as PlayedBySeat
      next[seat] = null
      return next
    })
  }, [])

  // 通过服务端状态推进推断各座位行动（推断逻辑在 action-feedback.ts 中单测覆盖）
  useEffect(() => {
    const prev = prevSnapshotRef.current
    if (prev) {
      const fx = inferAction(prev, view)
      if (fx) {
        showAction(fx.seat, fx.text)
        // 过牌与出牌同性质：清空该座位之前的出牌，让“过”独占出牌框
        if (fx.text === '过') clearSeatCards(fx.seat)
      }
    }
    prevSnapshotRef.current = snapshotOf(view)
  }, [view, showAction, clearSeatCards])

  // 出牌环节轮到某座位 → 先清空该座位出牌框里的行动文本（“过”轮到自己时消失）。
  // 抢地主/加倍环节结束时已清空所有行动文本，这里无需再受 callingClearedRef 限制。
  useEffect(() => {
    if (view.phase !== 'playing') return
    const seat = view.current
    setActionText((prev) => (prev[seat] == null ? prev : { ...prev, [seat]: null }))
  }, [view.phase, view.current])

  // 出牌阶段首次落牌 → 清空叫牌阶段遗留的行动文本（不误伤后续的“过”）
  useEffect(() => {
    if (view.phase === 'playing') {
      if (!callingClearedRef.current && view.lastPlayCards !== null && view.lastPlayCards.length > 0) {
        callingClearedRef.current = true
        setActionText({} as Record<Seat, string | null>)
      }
    } else {
      callingClearedRef.current = false
    }
  }, [view.phase, view.lastPlayCards])

  // 新一轮对局开始（进入发牌阶段）→ 清空上一轮遗留的行动文本
  useEffect(() => {
    if (view.phase === 'dealing' || (view.phase === 'calling' && view.callActor === 0)) {
      setActionText({} as Record<Seat, string | null>)
    }
  }, [view.phase, view.callActor])

  // —— 手牌拖拽连续选择（按住鼠标划过手牌拉起候选）——
  const dragRef = useRef(false)
  const suppressClickRef = useRef(false)
  useEffect(() => {
    const endDrag = () => {
      // 延迟到 click 事件之后复位，避免 pointerdown 已切换选择后 click 再切一次
      window.setTimeout(() => {
        dragRef.current = false
        suppressClickRef.current = false
      }, 0)
    }
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    window.addEventListener('blur', endDrag)
    return () => {
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
      window.removeEventListener('blur', endDrag)
    }
  }, [])

  // 每位玩家保留本轮最近一次出的牌；轮到自己时清空自己的出牌框
  useEffect(() => {
    setPlayedBySeat((prev) => {
      const next = [...prev] as PlayedBySeat
      let changed = false
      // 轮到自己 → 清空自己的出牌框（出牌阶段）
      if (view.phase === 'playing' && view.current === view.mySeat && next[view.mySeat] !== null) {
        next[view.mySeat] = null
        changed = true
      }
      // 刚出的牌 → 更新到对应座位
      if (view.lastPlayCards !== null && view.lastPlayCards.length > 0 && view.lastActor !== null) {
        const actor = view.lastActor
        const cards = view.lastPlayCards
        if (next[actor] !== cards) {
          next[actor] = cards
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [view.phase, view.current, view.mySeat, view.lastActor, view.lastPlayCards])

  // 反馈气泡自动淡出（约 2.6s），无需手动点击；用 ref 避免依赖回调身份
  const dismissNoticeRef = useRef(onDismissNotice)
  dismissNoticeRef.current = onDismissNotice
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => dismissNoticeRef.current(), 2600)
    return () => window.clearTimeout(t)
  }, [notice])

  const sortedHand = useMemo(() => sortHand(view.myHand), [view.myHand])
  const humanView = view.seats.find((s) => s.isHuman) ?? view.seats[view.mySeat]
  const otherSeats = view.seats.filter((s) => !s.isHuman)
  // 逆时针出牌顺序：下家（下一手行动者）显示在右侧，上家（上一手行动者）显示在左侧。
  // 座位号本身没有物理位置含义（由匹配顺序决定），这里按“座位号+1=下一手”映射到屏幕左右，
  // 保证任何座位号下，右侧都是下家、左侧都是上家。
  const nextSeat = ((view.mySeat + 1) % 3) as Seat
  const prevSeat = ((view.mySeat + 2) % 3) as Seat
  const botA = otherSeats.find((s) => s.seat === prevSeat) ?? otherSeats[0] // 上家 → 左侧
  const botB = otherSeats.find((s) => s.seat === nextSeat) ?? otherSeats[1] // 下家 → 右侧
  // 回合制阶段（叫/抢/加倍/出牌），发牌阶段不计
  const isTurnPhase = view.phase === 'calling' || view.phase === 'robbing' || view.phase === 'doubling' || view.phase === 'playing'
  const isMyTurn = !view.finished && isTurnPhase && view.current === view.mySeat
  const lastPlay = view.lastPlayCards && view.lastPlayCards.length > 0 ? classify(view.lastPlayCards) : null
  const canPass = view.phase === 'playing' && lastPlay !== null
  const canPlaySelected = (): boolean => {
    if (view.phase !== 'playing' || !isMyTurn || selected.length === 0) return false
    const play = classify(selected)
    if (!play) return false
    if (!canBeat(play, lastPlay)) return false
    return selected.every((c) => view.myHand.some((x) => x.r === c.r && x.s === c.s))
  }
  const showCountdown = remainingSeconds !== null && remainingSeconds > 0
  // 明牌座位的完整手牌（用于在个人名片上方展示）
  const revealedFor = (seatView: SeatView | undefined): Card[] | undefined => {
    if (!seatView) return undefined
    return view.revealed[seatView.seat] ? (seatView.hand ?? []) : undefined
  }
  // 座位 → 行动文本（带动画 key，保证同文案二次出现时重新播放入场动画）
  const actionFor = (seat: Seat): { text: string; id: number } | null => {
    const text = actionText[seat]
    return text ? { text, id: actionKeyRef.current[seat] ?? 0 } : null
  }

  return createElement('div', { className: 'ddz-body ddz-table-screen' },
    createElement('button', { className: 'ddz-table-exit', onClick: onExit }, '← 退出牌桌'),
    createElement('div', { className: 'ddz-table-reserved-bar', 'aria-hidden': true }),
    notice && view.phase !== 'playing' && createElement('div', { className: 'ddz-toast', onClick: onDismissNotice }, notice),

    createElement('div', { className: 'ddz-table ddz-game-table' },
      // 顶部揭示的地主底牌（进入出牌阶段才揭示）
      createElement('div', { className: 'ddz-top-reveal' },
        view.bottom.length > 0
          ? createElement('div', { key: 'revealed', className: 'ddz-reveal-cards is-revealed', 'aria-label': '已揭示的地主底牌', 'aria-live': 'polite' },
              ...view.bottom.map((card, i) => createElement('div', {
                key: i,
                className: 'ddz-reveal-card',
                style: { '--ddz-delay': `${i * 45}ms` },
              }, createElement(CardView, { card }))),
            )
          : createElement('div', { key: 'hidden', className: 'ddz-reveal-cards ddz-reveal-back-set', 'aria-label': '地主底牌待揭示' },
              ...[0, 1, 2].map((i) => createElement('div', {
                key: i,
                className: 'ddz-reveal-card',
                style: { '--ddz-delay': `${i * 45}ms` },
              }, createElement(CardBack))),
            ),
      ),
      createElement('div', { className: 'ddz-table-middle' },
        createElement('div', { className: 'ddz-side-zone left' },
          botA && createElement(SeatPanel, { view, seatView: botA, isTurn: isTurnPhase && view.current === botA.seat, revealedCards: revealedFor(botA) }),
          botA && createElement(PlayedArea, {
            seat: botA.seat,
            humanSeat: view.mySeat,
            cards: playedBySeat[botA.seat],
            countdownSeconds: isTurnPhase && view.current === botA.seat && showCountdown ? remainingSeconds : null,
            action: actionFor(botA.seat),
          }),
        ),
        createElement('div', { className: 'ddz-table-center', style: { textAlign: 'center' } },
          createElement('div', { className: 'ddz-table-turn-label' },
            view.phase === 'dealing'
              ? (view.dealRound === 0 ? '洗牌中…' : `发牌中… 第 ${view.dealRound}/3 轮`)
              : view.phase === 'calling'
                ? (callAnnouncement ?? (isMyTurn ? '轮到你叫地主' : '等待叫地主…'))
                : view.phase === 'robbing'
                  ? (callAnnouncement ?? (isMyTurn ? '轮到你抢地主' : '等待抢地主…'))
                  : view.phase === 'doubling'
                    ? (isMyTurn ? '轮到你加倍' : '等待加倍…')
                    : view.phase === 'playing'
                      ? (callAnnouncement ?? (isMyTurn ? '轮到你出牌' : '对手出牌中…'))
                      : ''),
          createElement('div', { className: 'ddz-multiplier', style: { marginTop: 6, display: 'inline-block' }, 'aria-live': 'polite' },
            `总倍率 ×${view.multiplier}`),
          ),
        createElement('div', { className: 'ddz-side-zone right' },
          botB && createElement(PlayedArea, {
            seat: botB.seat,
            humanSeat: view.mySeat,
            cards: playedBySeat[botB.seat],
            countdownSeconds: isTurnPhase && view.current === botB.seat && showCountdown ? remainingSeconds : null,
            action: actionFor(botB.seat),
          }),
          botB && createElement(SeatPanel, { view, seatView: botB, isTurn: isTurnPhase && view.current === botB.seat, revealedCards: revealedFor(botB) }),
        ),
      ),
      // 我的手牌与操作
      createElement('div', { className: 'ddz-human-area', style: { textAlign: 'center' } },
        createElement(PlayedArea, { seat: view.mySeat, humanSeat: view.mySeat, cards: playedBySeat[view.mySeat], action: actionFor(view.mySeat) }),
        createElement('div', { className: 'ddz-human-hand-row' },
          humanView && createElement(SeatPanel, { view, seatView: humanView, isTurn: isMyTurn, revealedCards: revealedFor(humanView) }),
          createElement('div', { className: 'ddz-row ddz-hand ddz-folded-cards ddz-human-hand' + (arranging ? ' ddz-hand-arranging' : ''), style: { flexWrap: 'nowrap', gap: 0, paddingBottom: 4 } },
            ...sortedHand.map((c, i) =>
              createElement('div', {
                key: `${c.r}-${c.s}`,
                className: 'ddz-hand-card ddz-card-stack-item',
                style: { '--ddz-delay': `${Math.min(i, 12) * 35}ms` },
                onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
                  if (event.button !== 0) return
                  dragRef.current = true
                  suppressClickRef.current = true
                  onToggleCard(c)
                },
                onPointerEnter: () => {
                  if (dragRef.current) onToggleCard(c)
                },
              }, createElement(CardView, {
                card: c,
                size: 'big',
                selected: selected.some((x) => x.r === c.r && x.s === c.s),
                onClick: () => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false
                    return
                  }
                  onToggleCard(c)
                },
              })),
            ),
          ),
        ),
        createElement('div', { className: 'ddz-action-dock ddz-row' + (isMyTurn ? ' is-active' : ''), style: { justifyContent: 'center', gap: 10, marginTop: 10 } },
          view.phase === 'dealing'
            ? (view.revealed[view.mySeat]
                ? createElement('span', { className: 'ddz-action-status ddz-dim' }, '已明牌')
                : view.dealRound >= 1
                  ? createElement('div', { className: 'ddz-row', style: { gap: 10 } },
                      createElement('span', { className: 'ddz-action-status ddz-dim' }, `发牌中 第 ${view.dealRound}/3 轮`),
                      createElement('button', { className: 'ddz-btn ddz-btn-red', onClick: () => { onMing(); showAction(view.mySeat, '明牌') } }, `明牌 ×${5 - view.dealRound}`),
                    )
                  : createElement('span', { className: 'ddz-action-status ddz-dim' }, '洗牌中…'))
            : view.phase === 'calling'
              ? (isMyTurn
                  ? createElement('div', { className: 'ddz-row', style: { gap: 10 } },
                      createElement('button', { className: 'ddz-btn', onClick: () => { onCall(true); showAction(view.mySeat, '叫地主') } }, '叫地主'),
                      createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: () => { onCall(false); showAction(view.mySeat, '不叫') } }, '不叫'),
                      showCountdown && createElement('span', {
                        className: 'ddz-countdown ddz-action-countdown' + ((remainingSeconds ?? 0) <= 3 ? ' urgent' : ''),
                        'aria-live': 'polite',
                      }, `${remainingSeconds}s`),
                    )
                  : createElement('span', { className: 'ddz-action-status ddz-dim' }, '等待叫地主…'))
              : view.phase === 'robbing'
                ? (isMyTurn
                    ? createElement('div', { className: 'ddz-row', style: { gap: 10 } },
                        createElement('button', { className: 'ddz-btn', onClick: () => { onCall(true); showAction(view.mySeat, '抢地主') } }, '抢地主'),
                        createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: () => { onCall(false); showAction(view.mySeat, '不抢') } }, '不抢'),
                        showCountdown && createElement('span', {
                          className: 'ddz-countdown ddz-action-countdown' + ((remainingSeconds ?? 0) <= 3 ? ' urgent' : ''),
                          'aria-live': 'polite',
                        }, `${remainingSeconds}s`),
                      )
                    : createElement('span', { className: 'ddz-action-status ddz-dim' }, '等待抢地主…'))
                : view.phase === 'doubling'
                  ? (isMyTurn
                      ? createElement('div', { className: 'ddz-row', style: { gap: 10 } },
                          createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: () => { onDouble(0); showAction(view.mySeat, '不加倍') } }, '不加倍'),
                          createElement('button', { className: 'ddz-btn', onClick: () => { onDouble(1); showAction(view.mySeat, '加倍') } }, '加倍 ×2'),
                          createElement('button', { className: 'ddz-btn ddz-btn-gold', onClick: () => { onDouble(2); showAction(view.mySeat, '超级加倍') } }, '超级加倍 ×4'),
                          showCountdown && createElement('span', {
                            className: 'ddz-countdown ddz-action-countdown' + ((remainingSeconds ?? 0) <= 3 ? ' urgent' : ''),
                            'aria-live': 'polite',
                          }, `${remainingSeconds}s`),
                        )
                      : createElement('span', { className: 'ddz-action-status ddz-dim' }, '等待加倍…'))
                  : (view.phase === 'playing'
                      ? (isMyTurn
                          ? createElement('div', { className: 'ddz-row', style: { gap: 10 } },
                              view.landlord === view.mySeat && !view.revealed[view.mySeat] && view.landlordPlays === 0
                                && createElement('button', { className: 'ddz-btn ddz-btn-red', onClick: () => { onMing(); showAction(view.mySeat, '明牌') } }, '明牌'),
                              createElement('button', { className: 'ddz-btn', disabled: !canPlaySelected(), onClick: onPlay }, '出牌'),
                              createElement('div', { className: 'ddz-action-hint' },
                                notice && createElement('div', { className: 'ddz-action-bubble', role: 'status', onClick: onDismissNotice }, notice),
                                createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: onHint }, '提示'),
                              ),
                              createElement('button', { className: 'ddz-btn ddz-btn-ghost', disabled: !canPass, onClick: () => { onPass(); showAction(view.mySeat, '过'); clearSeatCards(view.mySeat) } }, '过'),
                              showCountdown && createElement('span', {
                                className: 'ddz-countdown ddz-action-countdown' + ((remainingSeconds ?? 0) <= 3 ? ' urgent' : ''),
                                'aria-live': 'polite',
                              }, `${remainingSeconds}s`),
                            )
                          : createElement('span', { className: 'ddz-action-status ddz-turn' }, '对手思考中…'))
                      : null),
        ),
      ),
    ),
  )
}

function SeatPanel(props: { view: TableView; seatView: SeatView; isTurn: boolean; revealedCards?: Card[] }) {
  const { view, seatView, isTurn, revealedCards } = props
  // 场上实时总倍数（明牌/抢地主/加倍都会即时翻倍）
  const statusLabel = seatView.isHuman ? `倍率 ×${view.multiplier}` : seatView.handCount + ' 张手牌'
  const statusClass = seatView.isHuman ? 'ddz-multiplier' : 'ddz-card-count'
  return createElement('div', { className: 'ddz-seat' },
    revealedCards && revealedCards.length > 0
      && createElement('div', { className: 'ddz-revealed-row', role: 'img', 'aria-label': `${seatView.nickname}明牌` },
        ...revealedCards.map((c) => createElement('div', {
          key: `${c.r}-${c.s}`,
          className: 'ddz-revealed-card',
        }, createElement(CardView, { card: c, size: 'mini' })))),
    createElement('div', { className: 'ddz-seat-identity' },
      createElement(PlayerRank, { tokenBalance: seatView.tokenBalance }),
      createElement('div', { className: 'ddz-seat-chip' + (isTurn ? ' is-turn' : '') },
        createElement(Avatar, { avatarId: seatView.avatarId, size: 32 }),
        createElement('div', { className: 'ddz-seat-copy' },
          createElement('div', { className: 'ddz-seat-name', style: { gap: 6 } },
            createElement('span', { style: { fontSize: 13, fontWeight: 600 } }, seatView.nickname),
            seatView.role && createElement(RoleBadge, { role: seatView.role }),
          ),
          createElement('div', { className: 'ddz-seat-meta' }, `Token ${formatTokenCount(seatView.tokenBalance)}`),
        ),
      ),
    ),
    createElement('div', { className: 'ddz-seat-cards' },
      createElement('span', { className: statusClass }, statusLabel),
    ),
  )
}

/* ============================== 本地档案 / 经济 ============================== */

interface Profile {
  uid: string
  nickname: string
  avatarId: string
}

const MAX_NICKNAME_LENGTH = 12

function limitNickname(value: unknown): string {
  const nickname = typeof value === 'string' ? value.trim() : ''
  return Array.from(nickname).slice(0, MAX_NICKNAME_LENGTH).join('') || '斗地主玩家'
}

function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem('ddz:profile')
    if (raw) {
      const profile = JSON.parse(raw) as Profile
      return { ...profile, nickname: limitNickname(profile.nickname) }
    }
  } catch { /* ignore */ }
  const profile: Profile = {
    uid: crypto.randomUUID(),
    nickname: limitNickname('斗地主玩家' + Math.floor(1000 + Math.random() * 9000)),
    avatarId: Math.random() < 0.5 ? 'default-01' : 'default-02',
  }
  localStorage.setItem('ddz:profile', JSON.stringify(profile))
  return profile
}

function saveProfile(profile: Profile): void { localStorage.setItem('ddz:profile', JSON.stringify(profile)) }

/* ============================== 大厅 ============================== */

function Lobby(props: {
  profile: Profile
  balance: number
  onClaim: () => void
  claimed: boolean
  online: boolean
  matching: boolean
  matchCount: number
  rescued: boolean
  syncing: boolean
  lobbyLatency: number | null
  onRetryConnect: () => void
  onRescue: () => void
  onStartOnline: (tableId: string) => void
  onStartBot: () => void
  onCancelMatch: () => void
  onProfileChange: (profile: Profile) => void
  onClose: () => void
}) {
  const {
    profile, balance, onClaim, claimed, online, matching, matchCount, rescued, onRescue,
    syncing, lobbyLatency, onRetryConnect,
    onStartOnline, onStartBot, onCancelMatch, onProfileChange, onClose,
  } = props
  const rank = rankForBalance(balance)
  const minBalance = Math.min(...CONFIG.tables.map((t) => t.minBalance))
  const thresholdLabel = (t: { minBalance: number; maxBalance?: number }): string =>
    t.maxBalance === undefined
      ? `${t.minBalance.toLocaleString()}+`
      : `${t.minBalance.toLocaleString()}–${t.maxBalance.toLocaleString()}`
  const lobbyLatencyClass = lobbyLatency === null ? '' : lobbyLatency < 100 ? ' good' : lobbyLatency < 250 ? ' mid' : ' bad'
  const [tableId, setTableId] = useState(CONFIG.tables[0]!.id)
  // 桌别可进入性：余额需在 [min, max] 区间（max 可选）
  const selectedTable = tableById(tableId)
  const entryIssue = !selectedTable
    ? null
    : balance < selectedTable.minBalance
      ? 'low'
      : selectedTable.maxBalance !== undefined && balance > selectedTable.maxBalance
        ? 'high'
        : null
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)
  const [editingNickname, setEditingNickname] = useState(false)
  const [nicknameDraft, setNicknameDraft] = useState(profile.nickname)
  // 匹配已等待秒数（用于在“匹配中…”旁展示已等待时长）
  const [matchElapsed, setMatchElapsed] = useState(0)
  useEffect(() => {
    if (!matching) return
    setMatchElapsed(0)
    const timer = window.setInterval(() => setMatchElapsed((s) => s + 1), 1000)
    return () => window.clearInterval(timer)
  }, [matching])

  // 段位说明弹窗
  const [rankInfoOpen, setRankInfoOpen] = useState(false)
  useEffect(() => {
    if (!rankInfoOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setRankInfoOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [rankInfoOpen])

  const saveNickname = () => {
    const nickname = limitNickname(nicknameDraft)
    onProfileChange({ ...profile, nickname })
    setNicknameDraft(nickname)
    setEditingNickname(false)
  }

  return createElement(Fragment, null,
    createElement('div', { className: 'ddz-body ddz-lobby' },
    createElement('div', { className: 'ddz-lobby-top' },
      createElement('div', { className: 'ddz-lobby-profile-stack' },
        createElement('div', { className: 'ddz-profile ddz-row' },
          createElement('div', { className: 'ddz-avatar-picker-anchor' },
            createElement('button', {
              type: 'button',
              className: 'ddz-avatar-button',
              'aria-label': '选择默认头像',
              'aria-haspopup': 'dialog',
              'aria-expanded': avatarPickerOpen,
              onClick: () => { setAvatarPickerOpen((open) => !open); setEditingNickname(false) },
            }, createElement(Avatar, { avatarId: profile.avatarId })),
            avatarPickerOpen && createElement('div', { className: 'ddz-avatar-picker', role: 'dialog', 'aria-label': '选择默认头像' },
              createElement('div', { className: 'ddz-avatar-picker-title' }, '选择默认头像'),
              createElement('div', { className: 'ddz-avatar-options' },
                ...[
                  { id: 'default-01', label: '蓝色' },
                  { id: 'default-02', label: '黑色' },
                ].map((avatar) => createElement('button', {
                  key: avatar.id,
                  type: 'button',
                  className: 'ddz-avatar-option' + (profile.avatarId === avatar.id ? ' selected' : ''),
                  'aria-label': `选择${avatar.label}默认头像`,
                  'aria-pressed': profile.avatarId === avatar.id,
                  onClick: () => {
                    onProfileChange({ ...profile, avatarId: avatar.id })
                    setAvatarPickerOpen(false)
                  },
                },
                  createElement(Avatar, { avatarId: avatar.id, size: 34 }),
                  createElement('span', null, avatar.label),
                )),
              ),
            ),
          ),
          createElement('div', { className: 'ddz-profile-copy' },
            editingNickname
              ? createElement('div', { className: 'ddz-nickname-editor' },
                  createElement('input', {
                    className: 'ddz-nickname-input',
                    value: nicknameDraft,
                    maxLength: MAX_NICKNAME_LENGTH,
                    autoFocus: true,
                    'aria-label': '编辑昵称',
                    onChange: (event: { target: { value: string } }) => setNicknameDraft(event.target.value),
                    onKeyDown: (event: { key: string }) => {
                      if (event.key === 'Enter') saveNickname()
                      if (event.key === 'Escape') { setNicknameDraft(profile.nickname); setEditingNickname(false) }
                    },
                  }),
                  createElement('button', { type: 'button', className: 'ddz-icon-btn', 'aria-label': '保存昵称', onClick: saveNickname }, createElement(CheckIcon)),
                  createElement('button', { type: 'button', className: 'ddz-icon-btn', 'aria-label': '取消编辑昵称', onClick: () => { setNicknameDraft(profile.nickname); setEditingNickname(false) } }, createElement(CloseIcon)),
                )
              : createElement('div', { className: 'ddz-profile-name-row' },
                  createElement('span', { className: 'ddz-profile-name' }, profile.nickname),
                  createElement('button', { type: 'button', className: 'ddz-icon-btn', 'aria-label': '编辑昵称', onClick: () => { setNicknameDraft(profile.nickname); setEditingNickname(true); setAvatarPickerOpen(false) } }, createElement(EditIcon)),
                ),
            createElement('div', { className: 'ddz-dim ddz-profile-uid' }, 'UID ' + profile.uid.slice(0, 8)),
          ),
          createElement('button', {
            type: 'button',
            className: 'ddz-rank',
            'aria-haspopup': 'dialog',
            'aria-expanded': rankInfoOpen,
            title: '查看段位说明',
            onClick: () => setRankInfoOpen(true),
          }, rank.name),
        ),
        createElement('div', { className: 'ddz-balance ddz-row' },
          createElement('div', { className: 'ddz-balance-copy' },
            createElement('div', { className: 'ddz-balance-label' }, 'Token 余额' + (online ? '（在线）' : '')),
            createElement('div', { className: 'ddz-balance-value' }, balance.toLocaleString()),
            syncing && createElement('div', { className: 'ddz-dim', style: { fontSize: 12 } }, '同步中…'),
          ),
          createElement('button', {
            className: 'ddz-btn ddz-balance-btn',
            disabled: claimed || !online,
            onClick: onClaim,
          }, claimed ? '今日已领' : `签到 +${CONFIG.dailyTokens.toLocaleString()}`),
        ),
        online && balance < minBalance && createElement('div', { className: 'ddz-row', style: { marginTop: 12 } },
          rescued
            ? createElement('span', { className: 'ddz-dim ddz-helper' }, '今日救济金已领')
            : createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: onRescue },
                `领救济金 +${CONFIG.rescueTokens.toLocaleString()}`),
        ),
        !online && createElement('div', { className: 'ddz-lobby-connect' },
          syncing
            ? createElement('span', { className: 'ddz-dim' }, '正在连接在线对战…')
            : createElement(Fragment, null,
                createElement('span', { className: 'ddz-dim' }, '在线连接失败，无法对战'),
                createElement('button', { className: 'ddz-btn ddz-btn-ghost', style: { marginLeft: 8, padding: '6px 12px' }, onClick: onRetryConnect }, '重试'),
              ),
        ),
        online && createElement('div', { className: 'ddz-lobby-latency' + lobbyLatencyClass, role: 'status', title: '到在线服务器的网络延迟' },
          createElement('span', { className: 'ddz-latency-dot' }),
          createElement('span', null, '网络延迟 '),
          lobbyLatency === null
            ? createElement('span', null, '—')
            : createElement('b', null, `${lobbyLatency}ms`),
        ),
      ),
    ),
    createElement('div', { className: 'ddz-lobby-intro' },
      createElement('div', { className: 'ddz-section-title' }, '选择桌别'),
      createElement('div', { className: 'ddz-dim ddz-lobby-subtitle' },
        '在线匹配 3 名真人玩家；15 秒凑不齐则补入机器人对局'),
    ),
    createElement('div', { className: 'ddz-table-grid' },
      ...CONFIG.tables.map((t) =>
        createElement('button', {
          key: t.id,
          type: 'button',
          className: 'ddz-tab' + (tableId === t.id ? ' on' : ''),
          'aria-pressed': tableId === t.id,
          onClick: () => setTableId(t.id),
        },
          createElement('div', { style: { fontWeight: 700 } }, t.label),
          createElement('div', { className: 'ddz-dim', style: { fontSize: 12 } },
            `底分 ${t.base.toLocaleString()} · 余额门槛 ${thresholdLabel(t)}`),
        ),
      ),
    ),
    createElement('div', { className: 'ddz-lobby-actions' },
      matching
        ? createElement('button', { className: 'ddz-btn ddz-btn-red', onClick: onCancelMatch },
            `匹配中… ${matchElapsed}s · ${matchCount}/3（点击取消）`)
        : createElement('button', {
            className: 'ddz-btn',
            disabled: !online || entryIssue !== null,
            onClick: () => onStartOnline(tableId),
          }, '开始匹配'),
      createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: onClose }, '最小化'),
    ),
    matching && createElement('div', { className: 'ddz-row', style: { marginTop: 10, justifyContent: 'flex-start' } },
      createElement('button', { className: 'ddz-btn ddz-btn-bot', onClick: onStartBot }, '直接进入机器人对局'),
    ),
    entryIssue === 'low' &&
      createElement('div', { className: 'ddz-dim ddz-helper' },
        '余额不足该桌门槛，先签到或领救济金'),
    entryIssue === 'high' &&
      createElement('div', { className: 'ddz-dim ddz-helper' },
        '余额超过该桌上限，请选择更高档桌'),
    ),
    createElement('div', { className: 'ddz-lobby-version' }, `斗地主 v${APP_VERSION}`),
    createElement('div', { className: 'ddz-disclaimer' }, 'Token 为虚拟货币，仅作娱乐用途，不可兑换任何真实货币或服务（性质类似欢乐豆）'),
    rankInfoOpen && createElement('div', { className: 'ddz-dialog', onClick: () => setRankInfoOpen(false) },
      createElement('div', {
        className: 'ddz-dialog-card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '段位体系说明',
        onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
      },
        createElement('h3', { className: 'ddz-dialog-title' }, '段位体系'),
        createElement('div', { className: 'ddz-dialog-body' },
          '段位按 Token 当前余额实时划分：余额达标即升段，输钱掉余额即降段。段位仅作荣耀展示，不参与匹配。'),
        createElement('div', { className: 'ddz-rank-table', role: 'list' },
          ...CONFIG.ranks.map((r, i) => {
            const next = CONFIG.ranks[i + 1]
            const range = next
              ? `${r.min.toLocaleString()} – ${(next.min - 1).toLocaleString()}`
              : `${r.min.toLocaleString()}+`
            const isCurrent = r.id === rank.id
            return createElement('div', {
              key: r.id,
              role: 'listitem',
              className: 'ddz-rank-row' + (isCurrent ? ' is-current' : ''),
            },
              createElement('div', { className: 'ddz-rank-row-top' },
                createElement('span', { className: 'ddz-rank-row-name' },
                  r.name,
                  isCurrent && createElement('span', { className: 'ddz-rank-row-current' }, '当前段位'),
                ),
                createElement('span', { className: 'ddz-rank-row-range' }, range),
              ),
            )
          }),
        ),
        createElement('div', { className: 'ddz-row', style: { justifyContent: 'flex-end', gap: 10, marginTop: 16 } },
          createElement('button', { className: 'ddz-btn', onClick: () => setRankInfoOpen(false) }, '知道了'),
        ),
      ),
    ),
  )
}

/* ============================== 在线牌桌（真人 PVP） ============================== */

function OnlineTable(props: {
  roomId: string
  tableId: string
  profile: Profile
  onExit: () => void
  onSettled: (myDelta: number, balanceAfter: number, winner: string, spring: string, multiplier: number, rake: number) => void
}) {
  const { roomId, tableId, profile, onExit, onSettled } = props
  const [view, setView] = useState<TableView | null>(null)
  const [selected, setSelected] = useState<Card[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef(0)
  const pingRef = useRef<number | null>(null)
  // 结算回调稳定引用（配合“打完最后一手后延迟 1s 再进入结算”）
  const onSettledRef = useRef(onSettled)
  onSettledRef.current = onSettled
  // 已结算后不再重连（房间已清理）
  const settledRef = useRef(false)

  const send = useCallback((msg: unknown) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])

  // 连接 + 消息处理（含简单自动重连）
  useEffect(() => {
    let disposed = false
    let ws: WebSocket | null = null
    const open = () => {
      if (disposed) return
      ws = api.connectRoom(roomId)
      wsRef.current = ws
      ws.addEventListener('message', (ev) => {
        if (disposed) return
        const msg = JSON.parse(String(ev.data))
        if (msg.t === 'state') {
          setView(tableViewFromProtocol(msg.d))
          setClock(Date.now())
        } else if (msg.t === 'settle') {
          // 打完最后一手后停留约 1s 展示最终牌面，再进入结算弹窗
          const d = msg.d
          window.setTimeout(() => {
            if (disposed) return
            settledRef.current = true
            onSettledRef.current(d.myDelta, d.balance_after, d.winner, d.spring, d.multiplier, d.rake)
          }, 1000)
        } else if (msg.t === 'pong') {
          const ts = msg.d.ts as number
          if (ts !== undefined && pingRef.current !== null) {
            setLatencyMs(Math.max(0, Date.now() - ts))
          }
          pingRef.current = null
        } else if (msg.t === 'error') {
          setNotice(msg.d.message)
        }
      })
      ws.addEventListener('close', () => {
        if (disposed || settledRef.current) return
        if (reconnectRef.current < 3) {
          reconnectRef.current += 1
          setNotice(`连接断开，正在重连（${reconnectRef.current}/3）…`)
          window.setTimeout(open, 1500)
        } else {
          setNotice('连接已断开')
        }
      })
    }
    open()
    return () => {
      disposed = true
      ws?.close()
    }
  }, [roomId])

  // 倒计时刷新
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [])

  // 网络延迟探测：每 3s 发一次 ping，服务端回 pong 后算 RTT
  useEffect(() => {
    const timer = window.setInterval(() => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setLatencyMs(null)
        return
      }
      const ts = Date.now()
      pingRef.current = ts
      send({ v: PROTOCOL_VERSION, t: 'ping', d: { ts } })
    }, 3000)
    return () => window.clearInterval(timer)
  }, [send])

  const remainingSeconds = view && !view.finished
    ? Math.max(0, Math.ceil((view.turnStartedAt + view.turnTimeoutMs - clock) / 1000))
    : null

  // 手牌选择：即使轮不到自己出牌也能点选（但不能出），用于提前计划出牌
  const toggleSelect = (card: Card) => {
    if (!view || view.finished) return
    setSelected((prev) => {
      const idx = prev.findIndex((x) => x.r === card.r && x.s === card.s)
      if (idx >= 0) return prev.filter((_, i) => i !== idx)
      return [...prev, card]
    })
  }

  const doHint = () => {
    if (!view || view.finished || view.current !== view.mySeat) return
    const last = view.lastPlayCards && view.lastPlayCards.length > 0 ? classify(view.lastPlayCards) : null
    const h = hintPlay(view.myHand, last)
    if (!h) { setNotice('没有能压过的牌，过吧'); return }
    setNotice(null)
    setSelected(h)
  }

  const latencyClass = latencyMs === null ? '' : latencyMs < 100 ? ' good' : latencyMs < 250 ? ' mid' : ' bad'
  const latencyFooter = createElement('div', { className: 'ddz-latency' + latencyClass, role: 'status', 'aria-live': 'polite' },
    createElement('span', { className: 'ddz-latency-dot' }),
    latencyMs === null
      ? createElement('span', null, '网络延迟 —')
      : createElement('span', null, '网络延迟 ', createElement('b', null, `${latencyMs}ms`)),
    createElement('span', { className: 'ddz-latency-sep' }, '·'),
    createElement('span', null, '版本 ', createElement('b', null, `v${APP_VERSION}`)),
  )

  if (!view) {
    return createElement(Fragment, null,
      createElement('div', { className: 'ddz-body ddz-table-screen' },
        createElement('div', { className: 'ddz-table ddz-game-table', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dz-dim)' } },
          '对局连接中…'),
      ),
      latencyFooter,
    )
  }

  return createElement(Fragment, null,
    createElement(GameTableShell, {
      view,
      selected,
      notice,
      remainingSeconds,
      onToggleCard: toggleSelect,
      onPlay: () => { send({ v: PROTOCOL_VERSION, t: 'play', d: { cards: selected } }); setSelected([]) },
      onPass: () => send({ v: PROTOCOL_VERSION, t: 'pass', d: {} }),
      onHint: doHint,
      onCall: (call) => send({ v: PROTOCOL_VERSION, t: 'call', d: { call } }),
      onDouble: (choice) => send({ v: PROTOCOL_VERSION, t: 'double', d: { choice } }),
      onMing: () => send({ v: PROTOCOL_VERSION, t: 'ming', d: {} }),
      callAnnouncement: null,
      onExit,
      onDismissNotice: () => setNotice(null),
    }),
    latencyFooter,
  )
}

/* ============================== 结算 ============================== */

/** 对局结算：以弹窗形式盖在牌桌之上（打完最后一手约 1s 后弹出） */
function SettleDialog(props: {
  result: { myDelta: number; multiplier: number; winner: string; spring: string; rake: number }
  balance: number
  onExit: () => void
}) {
  const { result, balance, onExit } = props
  const myDelta = result.myDelta
  const win = myDelta > 0
  return createElement('div', { className: 'ddz-dialog', onClick: onExit },
    createElement('div', {
      className: 'ddz-dialog-card',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '对局结算',
      onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
      style: { textAlign: 'center', padding: 26 },
    },
      createElement('div', { className: 'ddz-big', style: { color: win ? 'var(--dz-gold)' : myDelta === 0 ? 'var(--dz-dim)' : 'var(--dz-red)' } },
        win ? '🎉 你赢了' : myDelta === 0 ? '平局' : '这局输了'),
      createElement('div', { className: 'ddz-dim', style: { margin: '10px 0' } },
        `${result.winner} · ${result.spring === 'none' ? '无春天' : result.spring} · 总倍数 ×${result.multiplier} · 抽水 ${result.rake.toLocaleString()}`),
      createElement('div', { className: 'ddz-result-amount' },
        `${myDelta > 0 ? '+' : ''}${myDelta.toLocaleString()}`),
      createElement('div', { className: 'ddz-dim' }, `当前余额 ${balance.toLocaleString()}`),
      createElement('div', { className: 'ddz-row', style: { justifyContent: 'center', gap: 10, marginTop: 18 } },
        createElement('button', { className: 'ddz-btn', onClick: onExit }, '返回大厅'),
      ),
    ),
  )
}

/* ============================== 应用根 ============================== */

type PipBounds = { left: number; top: number; width: number; height: number }
type PipResizeDirection = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type PipInteraction = {
  kind: 'move' | 'resize'
  direction?: PipResizeDirection
  startX: number
  startY: number
  startBounds: PipBounds
}

const PIP_MIN_WIDTH = 360
const PIP_MIN_HEIGHT = 280
const PIP_MAX_WIDTH = 680
const PIP_MAX_HEIGHT = 600
/** 小窗长宽比约束（宽/高）：不能过窄过高，也不能过宽过扁（高 ≤ 1.43×宽，宽 ≤ 1.8×高） */
const PIP_MIN_ASPECT = 0.7
const PIP_MAX_ASPECT = 1.8

function getPipLimits() {
  const maxWidth = Math.max(1, window.innerWidth - 24)
  const maxHeight = Math.max(1, window.innerHeight - 24)
  return {
    minWidth: Math.min(PIP_MIN_WIDTH, maxWidth),
    minHeight: Math.min(PIP_MIN_HEIGHT, maxHeight),
    maxWidth,
    maxHeight,
  }
}

function clampPipBounds(bounds: PipBounds, anchor?: { right?: boolean; bottom?: boolean }): PipBounds {
  const limits = getPipLimits()
  const right = bounds.left + bounds.width
  const bottom = bounds.top + bounds.height
  let width = Math.min(Math.max(bounds.width, limits.minWidth), limits.maxWidth)
  let height = Math.min(Math.max(bounds.height, limits.minHeight), limits.maxHeight)
  // 长宽比约束：过宽则限制宽度、过窄则限制高度（再兜底回最小尺寸）
  if (width / height > PIP_MAX_ASPECT) width = Math.max(limits.minWidth, height * PIP_MAX_ASPECT)
  else if (width / height < PIP_MIN_ASPECT) height = Math.max(limits.minHeight, width / PIP_MIN_ASPECT)
  width = Math.min(Math.max(width, limits.minWidth), limits.maxWidth)
  height = Math.min(Math.max(height, limits.minHeight), limits.maxHeight)
  // 尺寸变化后按锚定边回算位置，避免小窗整体跳动：
  // 拖左/上边时，右/下边为锚定边，宽度/高度被约束后回算左/上位置（其余情况保持左/上不动）。
  const left = anchor?.right ? right - width : bounds.left
  const top = anchor?.bottom ? bottom - height : bounds.top
  return {
    width,
    height,
    left: Math.min(Math.max(left, 0), Math.max(0, window.innerWidth - width)),
    top: Math.min(Math.max(top, 0), Math.max(0, window.innerHeight - height)),
  }
}

function getInitialPipBounds(): PipBounds {
  const limits = getPipLimits()
  const width = Math.min(PIP_MAX_WIDTH, limits.maxWidth)
  const height = Math.min(PIP_MAX_HEIGHT, limits.maxHeight)
  return clampPipBounds({
    width,
    height,
    left: window.innerWidth - 18 - width,
    top: window.innerHeight - 18 - height,
  })
}

function resizePipBounds(start: PipBounds, direction: PipResizeDirection, deltaX: number, deltaY: number): PipBounds {
  const limits = getPipLimits()
  const right = start.left + start.width
  const bottom = start.top + start.height
  let left = start.left
  let top = start.top
  let width = start.width
  let height = start.height

  if (direction.includes('e')) {
    const maxWidth = Math.min(limits.maxWidth, window.innerWidth - start.left)
    width = Math.min(Math.max(start.width + deltaX, limits.minWidth), Math.max(limits.minWidth, maxWidth))
  } else if (direction.includes('w')) {
    const maxWidth = Math.min(limits.maxWidth, right)
    width = Math.min(Math.max(start.width - deltaX, limits.minWidth), Math.max(limits.minWidth, maxWidth))
    left = right - width
  }

  if (direction.includes('s')) {
    const maxHeight = Math.min(limits.maxHeight, window.innerHeight - start.top)
    height = Math.min(Math.max(start.height + deltaY, limits.minHeight), Math.max(limits.minHeight, maxHeight))
  } else if (direction.includes('n')) {
    const maxHeight = Math.min(limits.maxHeight, bottom)
    height = Math.min(Math.max(start.height - deltaY, limits.minHeight), Math.max(limits.minHeight, maxHeight))
    top = bottom - height
  }

  // 超过长宽比约束时，锚定被拖拽边的对边（拖左/上 → 固定右/下），保证小窗不整体移动
  return clampPipBounds({ left, top, width, height }, {
    right: direction.includes('w'),
    bottom: direction.includes('n'),
  })
}

function findHostNewSessionButton(): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>('button,[role="button"]')
  return Array.from(candidates).find((element) => {
    const text = (element.textContent ?? '').replace(/\s+/g, '')
    const aria = `${element.getAttribute('aria-label') ?? ''}${element.getAttribute('title') ?? ''}`.replace(/\s+/g, '')
    const className = String(element.className)
    return text === '新会话'
      || (aria.includes('新建会话') && (text.includes('新会话') || className.includes('newSession')))
  }) ?? null
}

function findHostWorkspaceSection(): { header: HTMLElement; section: HTMLElement } | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((element) => {
    const rect = element.getBoundingClientRect()
    return element.textContent?.trim() === '工作区' && rect.width > 0 && rect.height > 0
  })
  const label = candidates.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0]
  const header = label?.tagName === 'SPAN' ? label.parentElement : label
  const section = header?.parentElement
  return header && section ? { header, section } : null
}

function findHostSidebarToggle(): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>('button,[role="button"]')
  return Array.from(candidates).find((element) => {
    const label = `${element.getAttribute('aria-label') ?? ''}${element.getAttribute('title') ?? ''}`.replace(/\s+/g, '')
    return label.includes('侧边栏')
  }) ?? null
}

function findHostSidebarRight(): number {
  const target = findHostNewSessionButton()
  const root = target?.closest<HTMLElement>('[class*="_root"]')
  const rootRect = root?.getBoundingClientRect()
  return rootRect && rootRect.width > 0 ? Math.round(rootRect.right) : 280
}

function findHostSidebarRoot(): HTMLElement | null {
  return findHostNewSessionButton()?.closest<HTMLElement>('[class*="_root"]') ?? null
}

function SidebarEntry(props: { onOpen: () => void; active: boolean }) {
  const { onOpen, active } = props
  const [position, setPosition] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  useEffect(() => {
    let observedTarget: HTMLElement | null = null
    let resizeObserver: ResizeObserver | null = null
    let observedSection: HTMLElement | null = null
    let sectionResizeObserver: ResizeObserver | null = null
    let sectionReservation: { element: HTMLElement; originalMarginTop: string; reserve: number } | null = null

    const clearSectionReservation = () => {
      if (sectionReservation?.element.isConnected) {
        sectionReservation.element.style.marginTop = sectionReservation.originalMarginTop
      }
      sectionReservation = null
    }

    const updatePosition = () => {
      const target = findHostNewSessionButton()
      if (target !== observedTarget) {
        resizeObserver?.disconnect()
        resizeObserver = null
        observedTarget = target
        if (target && typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(updatePosition)
          resizeObserver.observe(target)
        }
      }
      if (!target) {
        clearSectionReservation()
        setPosition(null)
        return
      }
      const rect = target.getBoundingClientRect()
      const height = Math.max(40, Math.round(rect.height || 48))
      const workspace = findHostWorkspaceSection()
      if (workspace?.section !== observedSection) {
        sectionResizeObserver?.disconnect()
        sectionResizeObserver = null
        observedSection = workspace?.section ?? null
        if (observedSection && typeof ResizeObserver !== 'undefined') {
          sectionResizeObserver = new ResizeObserver(updatePosition)
          sectionResizeObserver.observe(observedSection)
        }
      }
      if (workspace && workspace.section !== sectionReservation?.element) {
        clearSectionReservation()
        sectionReservation = {
          element: workspace.section,
          originalMarginTop: workspace.section.style.marginTop,
          reserve: 0,
        }
      }
      if (workspace && sectionReservation) {
        const requiredTop = rect.bottom + 8 + height + 8
        const currentTop = workspace.header.getBoundingClientRect().top
        const baseTop = currentTop - sectionReservation.reserve
        const reserve = Math.max(0, Math.ceil(requiredTop - baseTop))
        if (sectionReservation.reserve !== reserve) {
          workspace.section.style.marginTop = reserve > 0
            ? `${reserve}px`
            : sectionReservation.originalMarginTop
          sectionReservation.reserve = reserve
        }
      } else {
        clearSectionReservation()
      }
      const toggle = findHostSidebarToggle()
      const toggleRect = toggle?.getBoundingClientRect()
      const workspaceVisible = Boolean(workspace)
      const top = workspaceVisible
        ? rect.bottom + 8
        : Math.max(rect.bottom + 8, (toggleRect?.bottom ?? 0) + 8)
      const nextPosition = {
        left: Math.round(rect.left),
        top: Math.max(8, Math.round(top)),
        width: Math.max(36, Math.round(rect.width)),
        height,
      }
      setPosition((previous) => previous
        && previous.left === nextPosition.left
        && previous.top === nextPosition.top
        && previous.width === nextPosition.width
        && previous.height === nextPosition.height
        ? previous
        : nextPosition)
    }

    const mutationObserver = new MutationObserver(updatePosition)
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-label'],
    })
    window.addEventListener('resize', updatePosition)
    document.addEventListener('transitionend', updatePosition, true)
    document.addEventListener('animationend', updatePosition, true)
    updatePosition()
    return () => {
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
      sectionResizeObserver?.disconnect()
      clearSectionReservation()
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('transitionend', updatePosition, true)
      document.removeEventListener('animationend', updatePosition, true)
    }
  }, [])

  const width = position?.width ?? Math.min(380, Math.max(48, window.innerWidth - 20))
  const compact = width < 180
  return createElement('div', {
    className: 'ddz-sidebar-entry-host' + (compact ? ' is-compact' : '') + (active ? ' is-active' : ''),
    style: {
      left: position?.left ?? 10,
      top: position?.top ?? 66,
      width,
      height: position?.height ?? 48,
    },
  },
  createElement('button', {
    type: 'button',
    className: 'ddz-sidebar-entry',
    'aria-label': active ? '关闭斗地主' : '打开斗地主',
    'aria-pressed': active,
    onClick: onOpen,
  },
    createElement('span', { className: 'ddz-sidebar-entry-icon', 'aria-hidden': true }, '🃏'),
    createElement('span', { className: 'ddz-sidebar-entry-copy' },
      createElement('span', { className: 'ddz-sidebar-entry-title' }, '斗地主'),
      createElement('span', { className: 'ddz-sidebar-entry-subtitle' }, '打开斗地主工作区'),
    ),
  ))
}

export function DoudizhuApp() {
  const [open, setOpen] = useState(false)
  const [standaloneOpen, setStandaloneOpen] = useState(false)
  // 宿主系统级模态（设置等 aria-modal 弹层）是否打开：打开时把斗地主的浮层下沉到宿主遮罩
  // 之下，入口与侧栏其它按钮一致变暗、不可点击，避免“依然亮着”盖在系统设置面板上。
  const [hostModal, setHostModal] = useState(false)
  const [sidebarRight, setSidebarRight] = useState(280)
  const [pipBounds, setPipBounds] = useState<PipBounds>(() => getInitialPipBounds())
  // 小窗内容自适应缩放比例：内容按可用区域等比缩放，避免出现滑块
  const [pipScale, setPipScale] = useState(1)
  const pipScaleRef = useRef<HTMLDivElement | null>(null)
  const [profile, setProfile] = useState<Profile>(() => loadProfile())
  const [balance, setBalance] = useState(0)
  const [claimed, setClaimed] = useState(false)
  const [screen, setScreen] = useState<'lobby' | 'table'>('lobby')
  const [tableId, setTableId] = useState(CONFIG.tables[0]!.id)
  const [result, setResult] = useState<{ myDelta: number; multiplier: number; winner: string; spring: string; rake: number } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [online, setOnline] = useState(false)
  const [matching, setMatching] = useState(false)
  const [matchCount, setMatchCount] = useState(0)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [rescued, setRescued] = useState(false)
  const [lobbyLatencyMs, setLobbyLatencyMs] = useState<number | null>(null)
  const [versionError, setVersionError] = useState<{ clientProtocol: number; serverProtocol: number; serverVersion: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const pollTimerRef = useRef<number | null>(null)
  const pipInteractionRef = useRef<PipInteraction | null>(null)
  const pipBodyStyleRef = useRef<{ cursor: string; userSelect: string } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const syncRef = useRef<Promise<void> | null>(null)

  // 在线大厅的网络延迟探测（HTTP RTT 到 /api/health）。
  // 仅在「在线 + 面板打开 + 处于大厅」时轮询，避免后台/对局中空转请求。
  // 顺带做协议一致性兜底：服务器协议变了就弹强制更新。
  useEffect(() => {
    if (!online || (!standaloneOpen && !open) || screen !== 'lobby') {
      setLobbyLatencyMs(null)
      return
    }
    let disposed = false
    const ping = async () => {
      const start = Date.now()
      try {
        const h = await api.health()
        if (disposed) return
        if (h.protocol !== PROTOCOL_VERSION) {
          setVersionError({ clientProtocol: PROTOCOL_VERSION, serverProtocol: h.protocol, serverVersion: h.version })
          setOnline(false)
          return
        }
        setLobbyLatencyMs(Date.now() - start)
      } catch {
        if (!disposed) setLobbyLatencyMs(null)
      }
    }
    ping()
    const timer = window.setInterval(ping, 3000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [online, open, standaloneOpen, screen])

  useEffect(() => {
    const updateSidebarRight = () => setSidebarRight(findHostSidebarRight())
    const observer = new MutationObserver(updateSidebarRight)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] })
    window.addEventListener('resize', updateSidebarRight)
    updateSidebarRight()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateSidebarRight)
    }
  }, [])

  // 监测宿主系统级模态（设置/附件查看等 `aria-modal` 弹层），打开时让斗地主浮层让位。
  // 斗地主自己的弹层（版本不兼容对话框等）挂在 [data-dsh-doudizhu] 根下，不计入。
  useEffect(() => {
    const hasHostModal = () => {
      const modals = document.querySelectorAll<HTMLElement>('[aria-modal="true"]')
      for (const el of modals) {
        if (el.closest('[data-dsh-doudizhu]')) continue
        return true
      }
      return false
    }
    const check = () => setHostModal(hasHostModal())
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'role'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const closeOnHostNavigation = (event: MouseEvent) => {
      if (!standaloneOpen && !open) return
      const target = event.target
      if (!(target instanceof HTMLElement) || target.closest('[data-dsh-doudizhu]')) return
      const sidebar = findHostSidebarRoot()
      if (!sidebar || !sidebar.contains(target)) return
      const navigationItem = target.closest('[role="treeitem"]')
      const newSession = findHostNewSessionButton()
      if (!navigationItem && !newSession?.contains(target)) return
      setStandaloneOpen(false)
    }
    document.addEventListener('click', closeOnHostNavigation, true)
    return () => document.removeEventListener('click', closeOnHostNavigation, true)
  }, [open, standaloneOpen])

  useEffect(() => {
    if (standaloneOpen) {
      document.body.dataset.dshDoudizhuStandalone = 'true'
    } else {
      delete document.body.dataset.dshDoudizhuStandalone
    }
    return () => { delete document.body.dataset.dshDoudizhuStandalone }
  }, [standaloneOpen])

  useEffect(() => {
    if (!open) return
    const endInteraction = () => {
      pipInteractionRef.current = null
      if (pipBodyStyleRef.current) {
        document.body.style.cursor = pipBodyStyleRef.current.cursor
        document.body.style.userSelect = pipBodyStyleRef.current.userSelect
        pipBodyStyleRef.current = null
      }
    }
    const onPointerMove = (event: PointerEvent) => {
      const interaction = pipInteractionRef.current
      if (!interaction) return
      const deltaX = event.clientX - interaction.startX
      const deltaY = event.clientY - interaction.startY
      setPipBounds(interaction.kind === 'move'
        ? clampPipBounds({
            ...interaction.startBounds,
            left: interaction.startBounds.left + deltaX,
            top: interaction.startBounds.top + deltaY,
          })
        : resizePipBounds(interaction.startBounds, interaction.direction!, deltaX, deltaY))
    }
    const onWindowResize = () => setPipBounds((current) => clampPipBounds(current))
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endInteraction)
    window.addEventListener('pointercancel', endInteraction)
    window.addEventListener('resize', onWindowResize)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endInteraction)
      window.removeEventListener('pointercancel', endInteraction)
      window.removeEventListener('resize', onWindowResize)
      endInteraction()
    }
  }, [open])

  // 小窗内容自适应：按画布可用区域等比缩放内容，避免出现滑块。
  // transform 不改变布局尺寸，可放心用 scrollWidth/scrollHeight 测自然尺寸；缩放不回写布局，不会形成循环。
  useEffect(() => {
    if (!open) {
      setPipScale(1)
      return
    }
    const el = pipScaleRef.current
    const canvas = el?.parentElement as HTMLElement | null
    if (!el || !canvas) return
    const update = () => {
      const availW = canvas.clientWidth
      const availH = canvas.clientHeight
      const naturalW = el.scrollWidth || availW
      const naturalH = el.scrollHeight || availH
      setPipScale(Math.min(1, availW / naturalW, availH / naturalH))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(canvas)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, screen])

  const beginPipInteraction = (
    event: ReactPointerEvent<HTMLDivElement>,
    interaction: Pick<PipInteraction, 'kind' | 'direction'>,
  ) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    if (!pipBodyStyleRef.current) {
      pipBodyStyleRef.current = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect }
    }
    pipInteractionRef.current = {
      ...interaction,
      startX: event.clientX,
      startY: event.clientY,
      startBounds: pipBounds,
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = interaction.kind === 'move'
      ? 'grabbing'
      : interaction.direction === 'n' || interaction.direction === 's' ? 'ns-resize'
        : interaction.direction === 'e' || interaction.direction === 'w' ? 'ew-resize'
          : interaction.direction === 'ne' || interaction.direction === 'sw' ? 'nesw-resize' : 'nwse-resize'
  }

  const startPipMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    beginPipInteraction(event, { kind: 'move' })
  }

  const startPipResize = (direction: PipResizeDirection) => (event: ReactPointerEvent<HTMLDivElement>) => {
    beginPipInteraction(event, { kind: 'resize', direction })
  }

  const copyUpdateCmd = () => {
    const cmd = 'dsh plugin --profile web add -w github:AwesomeHou/dsh-doudizhu'
    const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 1600) }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(cmd).then(done).catch(done)
    } else {
      done()
    }
  }

  // 启动即连接在线（唯一模式，无本地模式）：校验/同步放后台。
  // 协议不一致 → 强制弹窗；失败 → 大厅可重试。在线 Token 以服务端为权威，
  // 签到状态也来自服务端（与本地/机器人完全独立）。
  const enterOnline = () => {
    setOnline(true)
    setSyncing(true)
    syncRef.current = (async () => {
      try {
        const h = await api.health()
        if (h.protocol !== PROTOCOL_VERSION) {
          setVersionError({ clientProtocol: PROTOCOL_VERSION, serverProtocol: h.protocol, serverVersion: h.version })
          setOnline(false)
          return
        }
        await api.auth(profile.uid)
        const me = await api.getMe()
        setBalance(me.player.balance)
        setClaimed(me.player.claimedToday)
        setProfile((p) => ({ ...p, nickname: me.player.nickname, avatarId: me.player.avatarId }))
      } catch (e) {
        setNotice(e instanceof Error ? e.message : '在线连接失败')
        setOnline(false)
      } finally {
        setSyncing(false)
      }
    })()
  }

  // 挂载后自动连接在线
  useEffect(() => {
    enterOnline()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 应用级反馈气泡自动淡出（约 2.6s），无需手动点击
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 2600)
    return () => window.clearTimeout(t)
  }, [notice])

  const claim = async () => {
    if (claimed) return
    try {
      const r = await api.claimDaily()
      setBalance(r.balance)
      setClaimed(true)
      setNotice(`每日签到 +${r.amount.toLocaleString()}`)
    } catch (e) {
      // 已领取 → 同步服务端状态并给出明确提示（跨会话/跨设备时按钮可能重新可点）
      if ((e instanceof Error && e.message.includes('already claimed')) || String(e).includes('409')) {
        setClaimed(true)
        try {
          const me = await api.getMe()
          setBalance(me.player.balance)
        } catch { /* ignore */ }
        setNotice('今天已经签到过了，明天再来吧')
      } else {
        setNotice(e instanceof Error ? e.message : '签到失败')
      }
    }
  }

  const rescue = async () => {
    if (rescued || !online) return
    try {
      const r = await api.rescue()
      setBalance(r.balance)
      setRescued(true)
      setNotice(`救济金 +${r.amount.toLocaleString()}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (msg.includes('already rescued') || String(e).includes('409')) {
        setRescued(true)
      } else if (!msg.includes('not low enough')) {
        setNotice(msg || '领取失败')
      }
    }
  }

  const startOnline = async (tid: string) => {
    // 先等「切换在线」的后台同步完成（版本校验 + token + 余额），确保状态就绪
    if (syncRef.current) await syncRef.current
    if (!online) {
      setNotice('在线状态未就绪，请重试')
      return
    }
    setTableId(tid)
    setResult(null)
    setMatching(true)
    setMatchCount(1)
    try {
      const r = await api.joinQueue(tid)
      if (r.status === 'matched') {
        setMatchCount(3)
        setRoomId(r.roomId)
        setMatching(false)
        setScreen('table')
        return
      }
      setMatchCount(r.count)
      // 轮询等待匹配
      pollTimerRef.current = window.setInterval(async () => {
        try {
          const s = await api.pollQueue(tid)
          if (s.status === 'matched') {
            if (pollTimerRef.current !== null) window.clearInterval(pollTimerRef.current)
            setRoomId(s.roomId)
            setMatching(false)
            setScreen('table')
          } else {
            setMatchCount(s.count)
          }
        } catch { /* 网络抖动忽略 */ }
      }, 2000)
    } catch (e) {
      setMatching(false)
      setNotice(e instanceof Error ? e.message : '匹配失败')
    }
  }

  const cancelMatch = () => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
    setMatching(false)
    if (online) api.leaveQueue(tableId).catch(() => undefined)
  }

  // 直接进入机器人对局：跳过匹配等待，立即开「自己 + 2 机器人」的牌局
  const startBotGame = async () => {
    if (syncRef.current) await syncRef.current
    if (!online) { setNotice('在线状态未就绪，请重试'); return }
    // 先停掉普通匹配轮询（服务端 forceBot 会把玩家移出普通队列）
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
    setResult(null)
    try {
      const r = await api.joinQueueBot(tableId)
      if (r.status === 'matched') {
        setRoomId(r.roomId)
        setMatching(false)
        setScreen('table')
      } else {
        setNotice('机器人对局开启失败，请重试')
      }
    } catch (e) {
      setMatching(false)
      setNotice(e instanceof Error ? e.message : '进入机器人对局失败')
    }
  }

  const updateProfile = (next: Profile) => {
    const normalized = { ...next, nickname: limitNickname(next.nickname) }
    setProfile(normalized)
    saveProfile(normalized)
    if (online) {
      api.updateProfile(normalized.nickname, normalized.avatarId).catch(() => undefined)
    }
  }

  const onSettledOnline = useCallback((
    myDelta: number, balanceAfter: number, winner: string, spring: string, multiplier: number, rake: number,
  ) => {
    // 结算以弹窗形式盖在牌桌上，牌桌保持展示（打完最后一手约 1s 后弹出）
    setResult({ myDelta, multiplier, winner, spring, rake })
    setBalance(balanceAfter)
  }, [])

  const exitTable = () => {
    setRoomId(null)
    setResult(null)
    setScreen('lobby')
  }

  const requestPip = () => {
    setStandaloneOpen(false)
    setOpen(true)
  }
  const toggleStandalone = () => {
    setOpen(false)
    setStandaloneOpen((current) => !current)
  }
  const closeSurface = () => {
    if (standaloneOpen) {
      setStandaloneOpen(false)
    } else {
      setOpen(false)
    }
  }
  const panelContent = createElement(Fragment, null,
    screen === 'lobby' && createElement(Lobby, {
      profile, balance, claimed, online, matching, matchCount, rescued, syncing, lobbyLatency: lobbyLatencyMs,
      onClaim: claim,
      onRescue: rescue,
      onRetryConnect: enterOnline,
      onStartOnline: startOnline,
      onStartBot: startBotGame,
      onCancelMatch: cancelMatch,
      onProfileChange: updateProfile,
      onClose: closeSurface,
    }),
    screen === 'table' && roomId && createElement(OnlineTable, { roomId, tableId, profile, onExit: exitTable, onSettled: onSettledOnline }),
    screen === 'table' && result && createElement(SettleDialog, {
      result, balance, onExit: exitTable,
    }),
  )

  return createElement('div', { className: 'ddz-root', 'data-host-modal': hostModal ? 'true' : undefined },
    createElement('style', null, STYLE),
    notice && createElement('div', { className: 'ddz-toast', onClick: () => setNotice(null) }, notice),
    versionError && createElement('div', { className: 'ddz-dialog' },
      createElement('div', { className: 'ddz-dialog-card', role: 'alertdialog', 'aria-label': '版本不兼容', 'aria-modal': 'true' },
        createElement('h3', { className: 'ddz-dialog-title' }, '版本不兼容，需要更新'),
        createElement('div', { className: 'ddz-dialog-body' },
          '在线对战要求客户端与服务器协议一致。当前客户端协议 v' + versionError.clientProtocol
          + ' ≠ 服务器 v' + versionError.serverProtocol
          + '（服务器版本 ' + versionError.serverVersion + '）。请更新插件后重试。',
          createElement('code', { className: 'ddz-dialog-code' }, 'dsh plugin --profile web add -w github:AwesomeHou/dsh-doudizhu'),
        ),
        createElement('div', { className: 'ddz-row', style: { justifyContent: 'flex-end', gap: 10 } },
          createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: copyUpdateCmd },
            copied ? '已复制 ✓' : '复制更新命令'),
          createElement('button', { className: 'ddz-btn', onClick: () => setVersionError(null) }, '我知道了'),
        ),
      ),
    ),
    createElement(SidebarEntry, { onOpen: toggleStandalone, active: standaloneOpen || open }),
    standaloneOpen && createElement('div', {
      className: 'ddz-standalone-surface',
      role: 'main',
      'aria-label': '斗地主独立工作区',
      style: { left: sidebarRight },
    },
      createElement('div', { className: 'ddz-conversation-page' },
        createElement('button', { type: 'button', className: 'ddz-conversation-popout', onClick: requestPip, 'aria-label': '打开斗地主画中画小窗' }, '小窗'),
        createElement('div', { className: 'ddz-modal' }, panelContent),
      ),
    ),
    open && createElement('div', {
      className: 'ddz-pip-window',
      role: 'dialog',
      'aria-label': '斗地主画中画小窗',
      style: { left: pipBounds.left, top: pipBounds.top, width: pipBounds.width, height: pipBounds.height },
    },
      createElement('div', { className: 'ddz-modal' },
        createElement('div', { className: 'ddz-pip-toolbar', onPointerDown: startPipMove },
          createElement('span', null, '斗地主'),
          createElement('div', { className: 'ddz-pip-toolbar-actions' },
            createElement('button', { type: 'button', className: 'ddz-pip-toolbar-btn', onClick: () => { setOpen(false); setStandaloneOpen(true) } }, '放回斗地主工作区'),
            createElement('button', { type: 'button', className: 'ddz-pip-toolbar-btn', 'aria-label': '关闭斗地主小窗', onClick: () => setOpen(false) }, '×'),
            ),
          ),
        createElement('div', { className: 'ddz-pip-canvas' },
          createElement('div', {
            ref: pipScaleRef,
            className: 'ddz-pip-scale',
            style: { transform: `scale(${pipScale})` },
          }, panelContent),
        ),
      ),
      (['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'] as PipResizeDirection[]).map((direction) =>
        createElement('div', {
          key: direction,
          className: `ddz-pip-resize-handle is-${direction}`,
          'aria-hidden': true,
          onPointerDown: startPipResize(direction),
        }),
      ),
    ),
  )
}
