/**
 * dsh-doudizhu 客户端主界面（M1 本地 + M2 在线）
 * - 侧边栏入口 + 独立斗地主工作区 + 可调整画中画小窗
 * - 大厅：昵称/头像/段位/余额、每日签到、桌别选择、本地/在线模式切换
 * - 牌桌（本地机器人 or 线上真人 PVP）：叫地主/抢地主 → 出牌/过/提示 → 结算
 * - 经济：本地 localStorage 模拟；在线走 Cloudflare Worker（服务端权威记账）
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createElement, Fragment } from 'react'
import { CONFIG, rankForBalance, tableById } from '../../shared/config.ts'
import { cardName, sortHand } from '../../shared/engine/deck.ts'
import { applyAction, createGame, type GameState } from '../../shared/engine/game.ts'
import { settle } from '../../shared/engine/scoring.ts'
import { classify, hintPlay } from '../../shared/engine/valid.ts'
import { canBeat } from '../../shared/engine/compare.ts'
import { botCall, botMove } from '../../shared/engine/bot.ts'
import { KIND_NAMES, RANK_NAMES, SUIT_SYMBOLS, type Card, type Role, type Seat } from '../../shared/engine/types.ts'
import { deepseekBlueUrl, deepseekBlackUrl } from './brandAssets.ts'
import { PROTOCOL_VERSION, APP_VERSION } from '../../shared/protocol.ts'
import * as api from './api.ts'
import { tableViewFromEngine, tableViewFromProtocol, type TableView, type SeatView } from './table-view.ts'

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
.ddz-toast{position:fixed;left:50%;top:20px;transform:translateX(-50%);background:#fff;color:var(--dz-text);border:1px solid var(--dz-blue);border-radius:10px;padding:10px 18px;font-size:14px;z-index:2147483001;box-shadow:0 8px 12px rgba(26,32,47,.14);animation:ddz-toast-in .22s cubic-bezier(.22,1,.36,1) both}
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
.ddz-mode-switch{display:inline-flex;border:1px solid var(--dz-line);border-radius:999px;padding:3px;gap:2px;background:#f7f8fb}
.ddz-mode-btn{appearance:none;border:0;background:transparent;border-radius:999px;padding:6px 14px;font:inherit;font-size:13px;font-weight:600;color:var(--dz-dim);cursor:pointer}
.ddz-mode-btn.on{background:#fff;color:#304bc5;box-shadow:0 1px 4px rgba(26,32,47,.12)}
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
 @keyframes ddz-overlay-in{from{opacity:0}to{opacity:1}}
 @keyframes ddz-modal-in{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
@keyframes ddz-toast-in{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}
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
 @media (max-width:720px){.ddz-body{padding:16px}.ddz-corner-close{top:10px;right:12px}.ddz-table-exit{top:10px;left:12px}.ddz-table-reserved-bar{height:36px;flex-basis:36px}.ddz-lobby{padding:20px 16px 24px}.ddz-lobby-top{align-items:flex-start;flex-direction:column;margin-bottom:32px}.ddz-balance{width:auto;justify-content:flex-start}.ddz-balance-copy{align-items:flex-start}.ddz-table-grid{flex-direction:column}.ddz-table-grid .ddz-tab{flex-basis:auto}.ddz-top-reveal{min-height:64px}.ddz-table-middle{grid-template-columns:1fr 1.2fr 1fr;gap:6px}.ddz-side-zone{display:flex;flex-direction:column;gap:8px}.ddz-side-zone .ddz-play-area{min-height:72px}.ddz-table-center{min-height:110px;order:0}.ddz-seat{min-width:0}.ddz-card{width:38px;height:56px;font-size:18px}.ddz-card-rank{font-size:16px}.ddz-card-rank.long{font-size:14px}.ddz-card-corner.top{top:4px;left:4px}.ddz-card-corner.bottom{right:4px;bottom:4px}.ddz-folded-cards .ddz-card-stack-item:not(:first-child){margin-left:-20px}.ddz-table{padding:12px}.ddz-human-hand-row{flex-direction:column;align-items:center;gap:12px}.ddz-human-hand-row .ddz-seat{position:static}.ddz-human-hand{width:100%;flex:none;overflow-x:auto;justify-content:flex-start}}
 @media (prefers-reduced-motion:reduce){.ddz-btn,.ddz-sidebar-entry,.ddz-card{transition:none}.ddz-card:hover{transform:none}.ddz-card.sel{transform:translateY(-8px)}.ddz-pip-window,.ddz-modal,.ddz-toast,.ddz-avatar-picker,.ddz-reveal-card,.ddz-played-card,.ddz-hand-card,.ddz-action-dock.is-active,.ddz-seat-chip.is-turn,.ddz-countdown.urgent,.ddz-special-play,.ddz-special-label{animation:none!important}}
`

/* ============================== 基础组件 ============================== */

function CardView({ card, selected, onClick }: { card: Card; selected?: boolean; onClick?: () => void }) {
  const isRed = card.s === 1 || card.s === 2 || card.r >= 13
  const label = cardName(card)
  const rank = card.r < 13 ? RANK_NAMES[card.r]! : card.r === 13 ? '小王' : '大王'
  const suit = card.r < 13 ? SUIT_SYMBOLS[card.s]! : ''
  const rankClass = rank.length > 1 ? ' long' : ''
  return createElement('div', {
    className: 'ddz-card' + (isRed ? ' red' : '') + (selected ? ' sel' : ''),
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
    suit && createElement('span', { className: 'ddz-card-suit' }, suit),
  ),
  suit && createElement('span', { className: 'ddz-card-corner bottom', 'aria-hidden': true },
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

function PlayedArea({ seat, cards, countdownSeconds = null }: { seat: Seat; cards: Card[] | null; countdownSeconds?: number | null }) {
  const cardKey = cards?.map((card) => `${card.r}-${card.s}`).join('|') ?? 'empty'
  const play = cards ? classify(cards) : null
  const isSpecialPlay = play !== null && !['single', 'pair', 'triple'].includes(play.kind)
  const specialClass = isSpecialPlay && play ? ` ddz-special-play ddz-special-${play.kind}` : ''
  return createElement('div', {
    className: 'ddz-play-area',
    'aria-label': `${seatLabel(seat, 0)}出牌区${play ? `，${KIND_NAMES[play.kind]}` : ''}`,
  },
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
  return ['下家', '上家'][seat < humanSeat ? 0 : 1] ?? '对手'
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
  onExit: () => void
  onDismissNotice: () => void
}) {
  const { view, selected, notice, remainingSeconds, onToggleCard, onPlay, onPass, onHint, onCall, onExit, onDismissNotice } = props
  const [playedBySeat, setPlayedBySeat] = useState<PlayedBySeat>(() => [null, null, null])

  // 每位玩家保留本轮最近一次出的牌
  useEffect(() => {
    if (view.lastPlayCards === null || view.lastPlayCards.length === 0) {
      if (view.lastActor !== null && view.phase === 'playing') setPlayedBySeat([null, null, null])
      return
    }
    if (view.lastActor === null) return
    const actor = view.lastActor
    const cards = view.lastPlayCards
    setPlayedBySeat((prev) => {
      if (prev[actor] === cards) return prev
      const next = [...prev] as PlayedBySeat
      next[actor] = cards
      return next
    })
  }, [view.phase, view.lastActor, view.lastPlayCards])

  const sortedHand = useMemo(() => sortHand(view.myHand), [view.myHand])
  const humanView = view.seats.find((s) => s.isHuman) ?? view.seats[view.mySeat]
  const otherSeats = view.seats.filter((s) => !s.isHuman)
  const botA = otherSeats[0]
  const botB = otherSeats[1]
  const isMyTurn = view.phase !== 'settled' && !view.finished && view.current === view.mySeat
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

  return createElement('div', { className: 'ddz-body ddz-table-screen' },
    createElement('button', { className: 'ddz-table-exit', onClick: onExit }, '← 退出牌桌'),
    createElement('div', { className: 'ddz-table-reserved-bar', 'aria-hidden': true }),
    notice && view.phase !== 'playing' && createElement('div', { className: 'ddz-toast', onClick: onDismissNotice }, notice),

    createElement('div', { className: 'ddz-table ddz-game-table' },
      // 顶部揭示的地主底牌
      createElement('div', { className: 'ddz-top-reveal' },
        view.landlord !== null
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
          botA && createElement(SeatPanel, { view, seatView: botA, isTurn: view.current === botA.seat }),
          botA && createElement(PlayedArea, {
            seat: botA.seat,
            cards: playedBySeat[botA.seat],
            countdownSeconds: view.current === botA.seat && showCountdown ? remainingSeconds : null,
          }),
        ),
        createElement('div', { className: 'ddz-table-center', style: { textAlign: 'center' } },
          createElement('div', { className: 'ddz-table-turn-label' },
            view.phase === 'playing'
              ? (isMyTurn ? '轮到你出牌' : '对手出牌中…')
              : ''),
        ),
        createElement('div', { className: 'ddz-side-zone right' },
          botB && createElement(PlayedArea, {
            seat: botB.seat,
            cards: playedBySeat[botB.seat],
            countdownSeconds: view.current === botB.seat && showCountdown ? remainingSeconds : null,
          }),
          botB && createElement(SeatPanel, { view, seatView: botB, isTurn: view.current === botB.seat }),
        ),
      ),
      // 我的手牌与操作
      createElement('div', { className: 'ddz-human-area', style: { textAlign: 'center' } },
        createElement(PlayedArea, { seat: view.mySeat, cards: playedBySeat[view.mySeat] }),
        createElement('div', { className: 'ddz-human-hand-row' },
          humanView && createElement(SeatPanel, { view, seatView: humanView, isTurn: isMyTurn }),
          createElement('div', { className: 'ddz-row ddz-hand ddz-folded-cards ddz-human-hand', style: { flexWrap: 'nowrap', gap: 0, paddingBottom: 4 } },
            ...sortedHand.map((c, i) =>
              createElement('div', {
                key: `${c.r}-${c.s}-${i}`,
                className: 'ddz-hand-card ddz-card-stack-item',
                style: { '--ddz-delay': `${Math.min(i, 12) * 35}ms` },
              }, createElement(CardView, {
                card: c,
                selected: selected.some((x) => x.r === c.r && x.s === c.s),
                onClick: () => onToggleCard(c),
              })),
            ),
          ),
        ),
        createElement('div', { className: 'ddz-action-dock ddz-row' + (isMyTurn ? ' is-active' : ''), style: { justifyContent: 'center', gap: 10, marginTop: 10 } },
          view.phase === 'calling'
            ? (isMyTurn
                ? createElement('div', { className: 'ddz-row', style: { gap: 10 } },
                    createElement('button', { className: 'ddz-btn', onClick: () => onCall(true) }, '叫地主'),
                    createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: () => onCall(false) }, '不叫'),
                  )
                : createElement('span', { className: 'ddz-action-status ddz-dim' }, '等待叫地主…'))
            : (view.phase === 'playing'
                ? (isMyTurn
                    ? createElement('div', { className: 'ddz-row', style: { gap: 10 } },
                        createElement('button', { className: 'ddz-btn', disabled: !canPlaySelected(), onClick: onPlay }, '出牌'),
                        createElement('div', { className: 'ddz-action-hint' },
                          notice && createElement('div', { className: 'ddz-action-bubble', role: 'status', onClick: onDismissNotice }, notice),
                          createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: onHint }, '提示'),
                        ),
                        createElement('button', { className: 'ddz-btn ddz-btn-ghost', disabled: !canPass, onClick: onPass }, '过'),
                        isMyTurn && showCountdown && createElement('span', {
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

function SeatPanel(props: { view: TableView; seatView: SeatView; isTurn: boolean }) {
  const { view, seatView, isTurn } = props
  const roundMultiplier = view.phase === 'calling' ? view.callMultiplier : view.multiplier
  const statusLabel = seatView.isHuman ? `倍率 ×${roundMultiplier}` : seatView.handCount + ' 张手牌'
  const statusClass = seatView.isHuman ? 'ddz-multiplier' : 'ddz-card-count'
  return createElement('div', { className: 'ddz-seat' },
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

function loadBalance(): number {
  try { return Number(localStorage.getItem('ddz:balance') ?? 100_000) } catch { return 100_000 }
}
function saveBalance(v: number): void { localStorage.setItem('ddz:balance', String(v)) }
function saveProfile(profile: Profile): void { localStorage.setItem('ddz:profile', JSON.stringify(profile)) }

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

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
  onRescue: () => void
  onModeChange: (online: boolean) => void
  onStartLocal: (tableId: string) => void
  onStartOnline: (tableId: string) => void
  onCancelMatch: () => void
  onProfileChange: (profile: Profile) => void
  onClose: () => void
}) {
  const {
    profile, balance, onClaim, claimed, online, matching, matchCount, rescued, onRescue,
    syncing, lobbyLatency,
    onModeChange, onStartLocal, onStartOnline, onCancelMatch, onProfileChange, onClose,
  } = props
  const rank = rankForBalance(balance)
  const minBalance = Math.min(...CONFIG.tables.map((t) => t.minBalance))
  const lobbyLatencyClass = lobbyLatency === null ? '' : lobbyLatency < 100 ? ' good' : lobbyLatency < 250 ? ' mid' : ' bad'
  const [tableId, setTableId] = useState(CONFIG.tables[0]!.id)
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)
  const [editingNickname, setEditingNickname] = useState(false)
  const [nicknameDraft, setNicknameDraft] = useState(profile.nickname)

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
          createElement('span', { className: 'ddz-rank' }, rank.name),
        ),
        createElement('div', { className: 'ddz-balance ddz-row' },
          createElement('div', { className: 'ddz-balance-copy' },
            createElement('div', { className: 'ddz-balance-label' }, 'Token 余额' + (online ? '（在线）' : '')),
            createElement('div', { className: 'ddz-balance-value' }, balance.toLocaleString()),
            online && syncing && createElement('div', { className: 'ddz-dim', style: { fontSize: 12 } }, '同步中…'),
          ),
          createElement('button', {
            className: 'ddz-btn ddz-balance-btn',
            disabled: claimed,
            onClick: onClaim,
          }, claimed ? '今日已领' : `签到 +${CONFIG.dailyTokens.toLocaleString()}`),
        ),
        online && balance < minBalance && createElement('div', { className: 'ddz-row', style: { marginTop: 12 } },
          rescued
            ? createElement('span', { className: 'ddz-dim ddz-helper' }, '今日救济金已领')
            : createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: onRescue },
                `领救济金 +${CONFIG.rescueTokens.toLocaleString()}`),
        ),
      ),
      createElement('div', { className: 'ddz-mode-switch', role: 'group', 'aria-label': '对局模式' },
        createElement('button', { type: 'button', className: 'ddz-mode-btn' + (online ? '' : ' on'), onClick: () => onModeChange(false) }, '本地练习'),
        createElement('button', { type: 'button', className: 'ddz-mode-btn' + (online ? ' on' : ''), onClick: () => onModeChange(true) }, '在线对战'),
      ),
      online && createElement('div', { className: 'ddz-lobby-latency' + lobbyLatencyClass, role: 'status', title: '到在线服务器的网络延迟' },
        createElement('span', { className: 'ddz-latency-dot' }),
        createElement('span', null, '网络延迟 '),
        lobbyLatency === null
          ? createElement('span', null, '—')
          : createElement('b', null, `${lobbyLatency}ms`),
      ),
    ),
    createElement('div', { className: 'ddz-lobby-intro' },
      createElement('div', { className: 'ddz-section-title' }, '选择桌别'),
      createElement('div', { className: 'ddz-dim ddz-lobby-subtitle' },
        online ? '在线匹配 3 名真人玩家（Cloudflare 云端对局）' : '开局自动匹配 2 个本地机器人（M1 本地演示）'),
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
            `底注 ${t.base.toLocaleString()} · 余额门槛 ${t.minBalance.toLocaleString()}`),
        ),
      ),
    ),
    createElement('div', { className: 'ddz-lobby-actions' },
      matching
        ? createElement('button', { className: 'ddz-btn ddz-btn-red', onClick: onCancelMatch },
            `匹配中… ${matchCount}/3（点击取消）`)
        : createElement('button', {
            className: 'ddz-btn',
            // 在线看「桌别余额门槛」，本地看「底注」
            disabled: balance < (online
              ? (tableById(tableId)?.minBalance ?? 0)
              : (tableById(tableId)?.base ?? 0)),
            onClick: () => (online ? onStartOnline(tableId) : onStartLocal(tableId)),
          }, online ? '开始匹配' : '开始本地对局'),
      createElement('button', { className: 'ddz-btn ddz-btn-ghost', onClick: onClose }, '最小化'),
    ),
    balance < (online ? (tableById(tableId)?.minBalance ?? 0) : (tableById(tableId)?.base ?? 0)) &&
      createElement('div', { className: 'ddz-dim ddz-helper' },
        online ? '余额不足该桌门槛，先签到或领救济金' : '余额不足该桌底注，先签到或换低倍桌'),
    ),
    createElement('div', { className: 'ddz-lobby-version' }, `斗地主 v${APP_VERSION}`),
  )
}

/* ============================== 本地牌桌（机器人） ============================== */

const HUMAN_SEAT: Seat = 0
const LOCAL_SEAT_META = [
  { nickname: '你', avatarId: 'default-01', tokenBalance: 0 },
  { nickname: '机器人·蓝', avatarId: 'default-01', tokenBalance: 35_800_000 },
  { nickname: '机器人·黑', avatarId: 'default-02', tokenBalance: 24_200_000 },
]

function LocalTable(props: {
  tableId: string
  base: number
  profile: Profile
  balance: number
  onExit: () => void
  onFinished: (deltas: [number, number, number], multiplier: number, winner: string, spring: string, landlord: Seat, rake: number) => void
}) {
  const { tableId, base, profile, balance, onExit, onFinished } = props
  const [state, setState] = useState<GameState>(() => createGame())
  const [selected, setSelected] = useState<Card[]>([])
  const [busy, setBusy] = useState(false)
  const randomRef = useRef(Math.random)
  const [notice, setNotice] = useState<string | null>(null)
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null)
  const [clock, setClock] = useState(() => Date.now())

  const seatMeta = useMemo(() => LOCAL_SEAT_META.map((m, i) => i === HUMAN_SEAT
    ? { ...m, nickname: profile.nickname, avatarId: profile.avatarId, tokenBalance: balance }
    : m), [profile.nickname, profile.avatarId, balance])
  const view = useMemo(() => tableViewFromEngine(state, HUMAN_SEAT, seatMeta), [state, seatMeta])

  // 每次进入出牌阶段或轮转座位时，重置 25 秒出牌计时
  useEffect(() => {
    if (state.phase !== 'playing' || state.finished) {
      setTurnStartedAt(null)
      return
    }
    const startedAt = Date.now()
    setTurnStartedAt(startedAt)
    setClock(startedAt)
  }, [state.phase, state.current, state.finished])

  useEffect(() => {
    if (state.phase !== 'playing' || state.finished || turnStartedAt === null) return
    const timer = window.setInterval(() => setClock(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [state.phase, state.finished, turnStartedAt])

  // 本地演示中超时自动处理，避免玩家一直卡住牌局
  useEffect(() => {
    if (state.phase !== 'playing' || state.current !== HUMAN_SEAT || state.finished || turnStartedAt === null) return
    const timer = window.setTimeout(() => {
      setState((s) => {
        if (s.phase !== 'playing' || s.current !== HUMAN_SEAT || s.finished) return s
        const move = hintPlay(s.hands[HUMAN_SEAT]!, s.lastPlay)
        try {
          if (move) return applyAction(s, { type: 'play', seat: HUMAN_SEAT, cards: move })
          if (s.lastPlay !== null) return applyAction(s, { type: 'pass', seat: HUMAN_SEAT })
        } catch { /* 状态已变化时忽略超时动作 */ }
        return s
      })
      setSelected([])
      setNotice('出牌超时，已自动处理')
    }, Math.max(0, turnStartedAt + CONFIG.turnTimeoutMs - Date.now()))
    return () => window.clearTimeout(timer)
  }, [state.phase, state.current, state.finished, state.lastPlay, turnStartedAt])

  // 机器人自动行动
  useEffect(() => {
    if (state.finished || state.redeal || state.phase === 'settled') return
    if (state.current === HUMAN_SEAT) return
    const timer = window.setTimeout(() => {
      const seat = state.current
      if (state.phase === 'calling') {
        const call = botCall(state.hands[seat]!, randomRef.current)
        setState((s) => {
          try { return applyAction(s, { type: 'call', seat, call }) } catch { return s }
        })
      } else {
        const move = botMove(state.hands[seat]!, state.lastPlay)
        setState((s) => {
          try {
            return move === null
              ? applyAction(s, { type: 'pass', seat })
              : applyAction(s, { type: 'play', seat, cards: move })
          } catch { return s }
        })
      }
    }, 650)
    return () => window.clearTimeout(timer)
  }, [state])

  // 结算
  useEffect(() => {
    if (!state.finished || !state.settlement) return
    const t = window.setTimeout(() => {
      const s = settle(state.landlord!, state.winner!, base, state.multiplier, CONFIG.rakeRate)
      const winnerText = state.winner === 'landlord' ? '地主胜' : '农民胜'
      const springText = state.spring === 'none' ? '无' : state.spring === 'landlord' ? '春天' : '反春'
      onFinished(s.deltas, s.multiplier, winnerText, springText, state.landlord!, s.rake)
    }, 900)
    return () => window.clearTimeout(t)
  }, [state.finished, state.settlement, state.winner, state.multiplier, state.spring, state.landlord, base, onFinished])

  // 重新发牌（无人叫）
  useEffect(() => {
    if (state.redeal) {
      const t = window.setTimeout(() => setState(createGame()), 800)
      return () => window.clearTimeout(t)
    }
  }, [state.redeal])

  const toggleSelect = (card: Card) => {
    if (state.phase !== 'playing' || state.current !== HUMAN_SEAT) return
    setSelected((prev) => {
      const idx = prev.findIndex((x) => x.r === card.r && x.s === card.s)
      if (idx >= 0) return prev.filter((_, i) => i !== idx)
      return [...prev, card]
    })
  }

  const humanAct = (action: { type: 'play'; cards: Card[] } | { type: 'pass' } | { type: 'call'; call: boolean }) => {
    try {
      if (action.type === 'call') {
        setState((s) => applyAction(s, { type: 'call', seat: HUMAN_SEAT, call: action.call }))
        setBusy(true)
        window.setTimeout(() => setBusy(false), 300)
      } else if (action.type === 'pass') {
        setState((s) => applyAction(s, { type: 'pass', seat: HUMAN_SEAT }))
        setSelected([])
      } else {
        setState((s) => applyAction(s, { type: 'play', seat: HUMAN_SEAT, cards: action.cards }))
        setSelected([])
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    }
  }

  const doHint = () => {
    if (state.phase !== 'playing' || state.current !== HUMAN_SEAT) return
    const h = hintPlay(state.hands[HUMAN_SEAT]!, state.lastPlay)
    if (!h) {
      setNotice('没有能压过的牌，过吧')
      return
    }
    setNotice(null)
    setSelected(h)
  }

  const remainingMs = state.phase === 'playing' && turnStartedAt !== null
    ? Math.max(0, CONFIG.turnTimeoutMs - (clock - turnStartedAt))
    : null
  const remainingSeconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000)

  return createElement(GameTableShell, {
    view,
    selected,
    notice,
    remainingSeconds,
    onToggleCard: toggleSelect,
    onPlay: () => humanAct({ type: 'play', cards: selected }),
    onPass: () => humanAct({ type: 'pass' }),
    onHint: doHint,
    onCall: (call) => humanAct({ type: 'call', call }),
    onExit,
    onDismissNotice: () => setNotice(null),
  })
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
          onSettled(msg.d.myDelta, msg.d.balance_after, msg.d.winner, msg.d.spring, msg.d.multiplier, msg.d.rake)
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
        if (disposed) return
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
  }, [roomId, onSettled])

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

  const toggleSelect = (card: Card) => {
    if (!view || view.finished || view.current !== view.mySeat) return
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
      onExit,
      onDismissNotice: () => setNotice(null),
    }),
    latencyFooter,
  )
}

/* ============================== 结算 ============================== */

function Settle(props: {
  result: { myDelta: number; multiplier: number; winner: string; spring: string; rake: number }
  balance: number
  onExit: () => void
}) {
  const { result, balance, onExit } = props
  const myDelta = result.myDelta
  const win = myDelta > 0
  return createElement('div', { className: 'ddz-settle ddz-body' },
    createElement('div', { className: 'ddz-big', style: { color: win ? 'var(--dz-gold)' : 'var(--dz-red)' } },
      win ? '🎉 你赢了' : myDelta === 0 ? '平局' : '这局输了'),
    createElement('div', { className: 'ddz-dim', style: { margin: '10px 0' } },
      `${result.winner} · ${result.spring === 'none' ? '无春天' : result.spring} · 总倍数 ×${result.multiplier} · 抽水 ${result.rake.toLocaleString()}`),
    createElement('div', { className: 'ddz-result-amount' },
      `${myDelta > 0 ? '+' : ''}${myDelta.toLocaleString()}`),
    createElement('div', { className: 'ddz-dim' }, `当前余额 ${balance.toLocaleString()}`),
    createElement('div', { className: 'ddz-row', style: { justifyContent: 'center', gap: 10, marginTop: 18 } },
      createElement('button', { className: 'ddz-btn', onClick: onExit }, '返回大厅'),
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

function clampPipBounds(bounds: PipBounds): PipBounds {
  const limits = getPipLimits()
  const width = Math.min(Math.max(bounds.width, limits.minWidth), limits.maxWidth)
  const height = Math.min(Math.max(bounds.height, limits.minHeight), limits.maxHeight)
  return {
    width,
    height,
    left: Math.min(Math.max(bounds.left, 0), Math.max(0, window.innerWidth - width)),
    top: Math.min(Math.max(bounds.top, 0), Math.max(0, window.innerHeight - height)),
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

  return clampPipBounds({ left, top, width, height })
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
  const [sidebarRight, setSidebarRight] = useState(280)
  const [pipBounds, setPipBounds] = useState<PipBounds>(() => getInitialPipBounds())
  const [profile, setProfile] = useState<Profile>(() => loadProfile())
  const [balance, setBalance] = useState(() => loadBalance())
  const [claimed, setClaimed] = useState(() => localStorage.getItem('ddz:claim') === todayKey())
  const [screen, setScreen] = useState<'lobby' | 'table' | 'settle'>('lobby')
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

  // 切换到在线模式：立即切换 UI（避免点击等网络导致卡顿），校验/同步放后台。
  // 协议不一致 → 强制弹窗并回退本地；auth+me 同步余额/资料。
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
        setProfile((p) => ({ ...p, nickname: me.player.nickname, avatarId: me.player.avatarId }))
      } catch (e) {
        setNotice(e instanceof Error ? e.message : '在线连接失败')
        setOnline(false)
      } finally {
        setSyncing(false)
      }
    })()
  }

  const leaveOnline = () => {
    setOnline(false)
    if (matching) cancelMatch()
    setBalance(loadBalance())
  }

  const claim = async () => {
    if (claimed) return
    if (online) {
      try {
        const r = await api.claimDaily()
        setBalance(r.balance)
        setClaimed(true)
        setNotice(`每日签到 +${r.amount.toLocaleString()}`)
      } catch (e) {
        // 已领取 → 同步服务端状态
        if ((e instanceof Error && e.message.includes('already claimed')) || String(e).includes('409')) {
          setClaimed(true)
          try {
            const me = await api.getMe()
            setBalance(me.player.balance)
          } catch { /* ignore */ }
        } else {
          setNotice(e instanceof Error ? e.message : '签到失败')
        }
      }
      return
    }
    const next = balance + CONFIG.dailyTokens
    setBalance(next)
    saveBalance(next)
    localStorage.setItem('ddz:claim', todayKey())
    setClaimed(true)
    setNotice(`每日签到 +${CONFIG.dailyTokens.toLocaleString()}`)
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

  const startLocal = (tid: string) => {
    setTableId(tid)
    setResult(null)
    setScreen('table')
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

  const updateProfile = (next: Profile) => {
    const normalized = { ...next, nickname: limitNickname(next.nickname) }
    setProfile(normalized)
    saveProfile(normalized)
    if (online) {
      api.updateProfile(normalized.nickname, normalized.avatarId).catch(() => undefined)
    }
  }

  const onFinishedLocal = useCallback((
    deltas: [number, number, number], multiplier: number, winner: string, spring: string, _landlord: Seat, rake: number,
  ) => {
    setResult({ myDelta: deltas[HUMAN_SEAT], multiplier, winner, spring, rake })
    const next = Math.max(0, balance + deltas[HUMAN_SEAT])
    setBalance(next)
    saveBalance(next)
    setScreen('settle')
  }, [balance])

  const onSettledOnline = useCallback((
    myDelta: number, balanceAfter: number, winner: string, spring: string, multiplier: number, rake: number,
  ) => {
    setResult({ myDelta, multiplier, winner, spring, rake })
    setBalance(balanceAfter)
    setScreen('settle')
  }, [])

  const exitTable = () => {
    setRoomId(null)
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
      onModeChange: (nextOnline) => { if (nextOnline === online) return; if (nextOnline) enterOnline(); else leaveOnline() },
      onStartLocal: startLocal,
      onStartOnline: startOnline,
      onCancelMatch: cancelMatch,
      onProfileChange: updateProfile,
      onClose: closeSurface,
    }),
    screen === 'table' && (online && roomId
      ? createElement(OnlineTable, { roomId, tableId, profile, onExit: exitTable, onSettled: onSettledOnline })
      : createElement(LocalTable, {
          tableId, base: tableById(tableId)?.base ?? 0, profile, balance,
          onExit: exitTable, onFinished: onFinishedLocal,
        })),
    screen === 'settle' && result && createElement(Settle, {
      result, balance, onExit: () => setScreen('lobby'),
    }),
  )

  return createElement('div', { className: 'ddz-root' },
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
        panelContent,
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
