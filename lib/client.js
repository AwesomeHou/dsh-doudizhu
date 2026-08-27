window.__ModuleLoader__.load({
	id: "dsh-doudizhu",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let react = require("react");
let react_dom_client = require("react-dom/client");
//#region shared/config.ts
const CONFIG = {
	/** 开局倍数：每局起始总倍数（明牌/抢地主/加倍/炸弹/春天在此基础上再乘） */
	startMultiplier: 15,
	/** 每日签到 Token */
	dailyTokens: 2e3,
	/** 破产救济金 */
	rescueTokens: 2e3,
	/** 平台抽水率 */
	rakeRate: .05,
	/** 每手出牌倒计时（ms） */
	turnTimeoutMs: 25e3,
	/** 桌别（门槛=底注×N，保证救济金 2000 可回到最低桌） */
	tables: [
		{
			id: "novice",
			label: "新手场",
			base: 15,
			minBalance: 1e3,
			maxBalance: 15e4
		},
		{
			id: "normal",
			label: "普通场",
			base: 80,
			minBalance: 5e3
		},
		{
			id: "high",
			label: "高级场",
			base: 480,
			minBalance: 4e4
		}
	],
	/** 段位（按 Token 当前余额实时划分：达标即升，输钱即降） */
	ranks: [
		{
			id: 1,
			name: "小难梁",
			min: 0
		},
		{
			id: 2,
			name: "牢梁",
			min: 5e3
		},
		{
			id: 3,
			name: "梁子",
			min: 2e4
		},
		{
			id: 4,
			name: "梁圣",
			min: 1e5
		},
		{
			id: 5,
			name: "梁神",
			min: 5e5
		},
		{
			id: 6,
			name: "梁祖",
			min: 2e6
		}
	]
};
function tableById(id) {
	return CONFIG.tables.find((t) => t.id === id);
}
function rankForBalance(balance) {
	let cur = CONFIG.ranks[0];
	for (const r of CONFIG.ranks) if (balance >= r.min) cur = r;
	return cur;
}
//#endregion
//#region shared/engine/types.ts
/** 点数名（下标即 Rank） */
const RANK_NAMES = [
	"3",
	"4",
	"5",
	"6",
	"7",
	"8",
	"9",
	"10",
	"J",
	"Q",
	"K",
	"A",
	"2",
	"SJ",
	"BJ"
];
const SUIT_SYMBOLS = [
	"♣",
	"♦",
	"♥",
	"♠"
];
const KIND_NAMES = {
	single: "单张",
	pair: "对子",
	triple: "三张",
	triple_one: "三带一",
	triple_pair: "三带二",
	straight: "顺子",
	pair_straight: "连对",
	airplane: "飞机",
	airplane_single: "飞机带单",
	airplane_pair: "飞机带对",
	four_two: "四带二",
	four_pair_two: "四带两对",
	bomb: "炸弹",
	rocket: "王炸"
};
//#endregion
//#region shared/engine/deck.ts
/** 单张牌的可读名（如 "10♠"、"小王"） */
function cardName(c) {
	const names = [
		"3",
		"4",
		"5",
		"6",
		"7",
		"8",
		"9",
		"10",
		"J",
		"Q",
		"K",
		"A",
		"2",
		"小王",
		"大王"
	];
	return c.r < 13 ? names[c.r] + [
		"♣",
		"♦",
		"♥",
		"♠"
	][c.s] : names[c.r];
}
/** 手牌排序：按点数降序（方便展示/比较） */
function sortHand(hand) {
	return [...hand].sort((a, b) => b.r - a.r || a.s - b.s);
}
//#endregion
//#region shared/engine/compare.ts
/**
* 后手 play 能否压过先手 last。
* - last 为空（先手/领出）→ 任意合法牌型都可以出。
* - 王炸 > 一切；炸弹 > 普通牌型；同型比主点数，且长度必须相同。
*/
function canBeat(play, last) {
	if (!last) return true;
	if (play.kind === "rocket") return true;
	if (last.kind === "rocket") return false;
	if (play.kind === "bomb") {
		if (last.kind === "bomb") return play.rank > last.rank;
		return true;
	}
	if (last.kind === "bomb") return false;
	if (play.kind !== last.kind) return false;
	if (play.length !== last.length) return false;
	return play.rank > last.rank;
}
//#endregion
//#region shared/engine/valid.ts
/**
* 斗地主规则引擎 —— 出牌合法性
*/
/** 按点数聚合手牌 */
function groupByRank(hand) {
	const m = /* @__PURE__ */ new Map();
	for (const c of hand) {
		const arr = m.get(c.r);
		if (arr) arr.push(c);
		else m.set(c.r, [c]);
	}
	return m;
}
/** 是否连续且不含 2/王（可用于顺子/连对/飞机） */
function isRun(ranks, base) {
	return ranks.length === base && ranks.every((r) => r <= 11) && ranks[ranks.length - 1] - ranks[0] === base - 1;
}
/**
* 识别一手牌是什么牌型；非法返回 null。
* 这是"合法性"的第一道校验：由服务端权威裁决，客户端只做预判。
*/
function classify(cards) {
	const n = cards.length;
	if (n === 0) return null;
	const groups = [...groupByRank(cards).entries()].map(([r, arr]) => [r, arr.length]).sort((a, b) => a[0] - b[0]);
	const minRank = groups[0][0];
	const maxRank = groups[groups.length - 1][0];
	const ranks = groups.map((g) => g[0]);
	const allCount = (c) => groups.every((g) => g[1] === c);
	if (n === 2 && groups.length === 2 && minRank === 13 && maxRank === 14) return {
		kind: "rocket",
		rank: 14,
		length: 2
	};
	if (n === 4 && groups.length === 1 && groups[0][1] === 4) return {
		kind: "bomb",
		rank: groups[0][0],
		length: 4
	};
	if (n === 1) return {
		kind: "single",
		rank: groups[0][0],
		length: 1
	};
	if (n === 2 && groups.length === 1 && groups[0][1] === 2) return {
		kind: "pair",
		rank: groups[0][0],
		length: 2
	};
	if (n === 3 && groups.length === 1 && groups[0][1] === 3) return {
		kind: "triple",
		rank: groups[0][0],
		length: 3
	};
	if (n === 4 && groups.length === 2) {
		const t = groups.find((g) => g[1] === 3);
		const o = groups.find((g) => g[1] !== 3);
		if (t && o[1] === 1) return {
			kind: "triple_one",
			rank: t[0],
			length: 4
		};
	}
	if (n === 5 && groups.length === 2) {
		const t = groups.find((g) => g[1] === 3);
		const o = groups.find((g) => g[1] !== 3);
		if (t && o[1] === 2) return {
			kind: "triple_pair",
			rank: t[0],
			length: 5
		};
	}
	if (n === 6 && groups.length >= 2 && groups.some((g) => g[1] === 4)) {
		const f = groups.find((g) => g[1] === 4);
		const rest = groups.filter((g) => g[1] !== 4);
		if (rest.length === 1 && rest[0][1] === 2) return {
			kind: "four_two",
			rank: f[0],
			length: 6
		};
		if (rest.every((g) => g[1] === 1)) return {
			kind: "four_two",
			rank: f[0],
			length: 6
		};
	}
	if (n === 8 && groups.length === 3 && groups.some((g) => g[1] === 4)) {
		const f = groups.find((g) => g[1] === 4);
		const rest = groups.filter((g) => g[1] !== 4);
		if (rest.length === 2 && rest.every((g) => g[1] === 2)) return {
			kind: "four_pair_two",
			rank: f[0],
			length: 8
		};
	}
	if (n >= 5 && allCount(1) && maxRank <= 11 && isRun(ranks, n)) return {
		kind: "straight",
		rank: minRank,
		length: n
	};
	if (n >= 6 && n % 2 === 0 && groups.length === n / 2 && allCount(2) && maxRank <= 11 && isRun(ranks, groups.length)) return {
		kind: "pair_straight",
		rank: minRank,
		length: n
	};
	if (n >= 6 && n % 3 === 0 && allCount(3) && maxRank <= 11 && isRun(ranks, groups.length)) return {
		kind: "airplane",
		rank: minRank,
		length: n
	};
	if (n >= 8 && n % 4 === 0) {
		const triples = groups.filter((g) => g[1] === 3);
		const wings = groups.filter((g) => g[1] === 1);
		const tripleRanks = triples.map((g) => g[0]);
		if (triples.length >= 2 && wings.length === triples.length && maxRank <= 11 && isRun(tripleRanks, triples.length)) return {
			kind: "airplane_single",
			rank: tripleRanks[0],
			length: n
		};
	}
	if (n >= 10 && n % 5 === 0) {
		const triples = groups.filter((g) => g[1] === 3);
		const pairs = groups.filter((g) => g[1] === 2);
		const tripleRanks = triples.map((g) => g[0]);
		if (triples.length >= 2 && pairs.length === triples.length && maxRank <= 11 && isRun(tripleRanks, triples.length)) return {
			kind: "airplane_pair",
			rank: tripleRanks[0],
			length: n
		};
	}
	return null;
}
/** 手牌能否构造出指定牌型描述（只看张数满足，不看具体能取到哪几张） */
function hasEnoughFor(hand, play) {
	const counts = groupByRank(hand);
	const cnt = (r) => counts.get(r)?.length ?? 0;
	const countsOf = [...counts.entries()].map(([r, arr]) => [r, arr.length]);
	const tripleRanks = [];
	for (const [r, c] of countsOf) if (c >= 3 && r <= 11) tripleRanks.push(r);
	tripleRanks.sort((a, b) => a - b);
	const pairRanks = [];
	for (const [r, c] of countsOf) if (c >= 2) pairRanks.push(r);
	pairRanks.sort((a, b) => a - b);
	switch (play.kind) {
		case "single": return cnt(play.rank) >= 1;
		case "pair": return cnt(play.rank) >= 2;
		case "triple": return cnt(play.rank) >= 3;
		case "triple_one": return cnt(play.rank) >= 3 && hand.length >= 4;
		case "triple_pair": return cnt(play.rank) >= 3 && pairRanks.some((r) => r !== play.rank && cnt(r) >= 2);
		case "straight":
			for (let r = play.rank; r < play.rank + play.length; r++) if (cnt(r) < 1) return false;
			return true;
		case "pair_straight": {
			const k = play.length / 2;
			for (let r = play.rank; r < play.rank + k; r++) if (cnt(r) < 2) return false;
			return true;
		}
		case "airplane": {
			const k = play.length / 3;
			for (let r = play.rank; r < play.rank + k; r++) if (cnt(r) < 3) return false;
			return true;
		}
		case "airplane_single": {
			const k = play.length / 4;
			for (let r = play.rank; r < play.rank + k; r++) if (cnt(r) < 3) return false;
			return hand.length - 3 * k >= k;
		}
		case "airplane_pair": {
			const k = play.length / 5;
			for (let r = play.rank; r < play.rank + k; r++) if (cnt(r) < 3) return false;
			const used = /* @__PURE__ */ new Set();
			for (let r = play.rank; r < play.rank + k; r++) used.add(r);
			return pairRanks.filter((r) => !used.has(r)).length >= k;
		}
		case "four_two": return cnt(play.rank) >= 4 && hand.length >= 6;
		case "four_pair_two": {
			const used = /* @__PURE__ */ new Set([play.rank]);
			return cnt(play.rank) >= 4 && pairRanks.filter((r) => !used.has(r)).length >= 2;
		}
		case "bomb": return cnt(play.rank) >= 4;
		case "rocket": return cnt(13) >= 1 && cnt(14) >= 1;
	}
}
/** 手牌可构造的全部牌型描述（升序：越靠前越"小"） */
function legalPlays(hand, last) {
	const counts = groupByRank(hand);
	const cnt = (r) => counts.get(r)?.length ?? 0;
	const ranks = [...counts.keys()].sort((a, b) => a - b);
	const candidates = [];
	for (const r of ranks) {
		candidates.push({
			kind: "single",
			rank: r,
			length: 1
		});
		if (cnt(r) >= 2) candidates.push({
			kind: "pair",
			rank: r,
			length: 2
		});
		if (cnt(r) >= 3) {
			candidates.push({
				kind: "triple",
				rank: r,
				length: 3
			});
			candidates.push({
				kind: "triple_one",
				rank: r,
				length: 4
			});
			if (ranks.some((o) => o !== r && cnt(o) >= 2)) candidates.push({
				kind: "triple_pair",
				rank: r,
				length: 5
			});
		}
		if (cnt(r) >= 4) {
			candidates.push({
				kind: "bomb",
				rank: r,
				length: 4
			});
			candidates.push({
				kind: "four_two",
				rank: r,
				length: 6
			});
			if (ranks.filter((o) => o !== r && cnt(o) >= 2).length >= 2) candidates.push({
				kind: "four_pair_two",
				rank: r,
				length: 8
			});
		}
	}
	for (let start = 0; start <= 11; start++) {
		let len = 0;
		while (start + len <= 11 && cnt(start + len) >= 1) len++;
		for (let n = 5; n <= len; n++) candidates.push({
			kind: "straight",
			rank: start,
			length: n
		});
	}
	for (let start = 0; start <= 11; start++) {
		let len = 0;
		while (start + len <= 11 && cnt(start + len) >= 2) len++;
		for (let n = 3; n <= len; n++) candidates.push({
			kind: "pair_straight",
			rank: start,
			length: 2 * n
		});
	}
	for (let start = 0; start <= 11; start++) {
		let len = 0;
		while (start + len <= 11 && cnt(start + len) >= 3) len++;
		for (let n = 2; n <= len; n++) {
			const triples = 3 * n;
			candidates.push({
				kind: "airplane",
				rank: start,
				length: triples
			});
			if (hand.length - triples >= n) candidates.push({
				kind: "airplane_single",
				rank: start,
				length: 4 * n
			});
			const used = /* @__PURE__ */ new Set();
			for (let i = 0; i < n; i++) used.add(start + i);
			if (ranks.filter((r) => !used.has(r) && cnt(r) >= 2).length >= n) candidates.push({
				kind: "airplane_pair",
				rank: start,
				length: 5 * n
			});
		}
	}
	if (cnt(13) >= 1 && cnt(14) >= 1) candidates.push({
		kind: "rocket",
		rank: 14,
		length: 2
	});
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const p of candidates) {
		const key = `${p.kind}:${p.rank}:${p.length}`;
		if (seen.has(key)) continue;
		seen.add(key);
		if (hasEnoughFor(hand, p) && canBeat(p, last)) out.push(p);
	}
	return out;
}
/** 从手牌中取出一手符合描述的牌；取不到返回 null */
function buildPlay(hand, play) {
	const counts = groupByRank(hand);
	const take = (r, n) => {
		const arr = counts.get(r);
		return arr && arr.length >= n ? arr.slice(0, n) : null;
	};
	const pickWings = (count, used, mode) => {
		const res = [];
		for (const [r, cards] of counts) {
			if (used.has(r)) continue;
			if (mode === "pair") {
				if (cards.length >= 2) res.push(cards[0], cards[1]);
			} else res.push(cards[0]);
			if (res.length >= count) return res.slice(0, count);
		}
		return res.length >= count ? res.slice(0, count) : null;
	};
	switch (play.kind) {
		case "single": return take(play.rank, 1);
		case "pair": return take(play.rank, 2);
		case "triple": return take(play.rank, 3);
		case "triple_one": {
			const t = take(play.rank, 3);
			if (!t) return null;
			const w = pickWings(1, /* @__PURE__ */ new Set([play.rank]), "single");
			if (!w) return null;
			return [...t, ...w];
		}
		case "triple_pair": {
			const t = take(play.rank, 3);
			if (!t) return null;
			const w = pickWings(2, /* @__PURE__ */ new Set([play.rank]), "pair");
			if (!w) return null;
			return [...t, ...w];
		}
		case "straight": {
			const out = [];
			for (let r = play.rank; r < play.rank + play.length; r++) {
				const x = take(r, 1);
				if (!x) return null;
				out.push(x[0]);
			}
			return out;
		}
		case "pair_straight": {
			const out = [];
			const k = play.length / 2;
			for (let r = play.rank; r < play.rank + k; r++) {
				const x = take(r, 2);
				if (!x) return null;
				out.push(...x);
			}
			return out;
		}
		case "airplane": {
			const out = [];
			const k = play.length / 3;
			for (let r = play.rank; r < play.rank + k; r++) {
				const x = take(r, 3);
				if (!x) return null;
				out.push(...x);
			}
			return out;
		}
		case "airplane_single": {
			const out = [];
			const used = /* @__PURE__ */ new Set();
			const k = play.length / 4;
			for (let r = play.rank; r < play.rank + k; r++) {
				const x = take(r, 3);
				if (!x) return null;
				out.push(...x);
				used.add(r);
			}
			const w = pickWings(k, used, "single");
			if (!w) return null;
			return [...out, ...w];
		}
		case "airplane_pair": {
			const out = [];
			const used = /* @__PURE__ */ new Set();
			const k = play.length / 5;
			for (let r = play.rank; r < play.rank + k; r++) {
				const x = take(r, 3);
				if (!x) return null;
				out.push(...x);
				used.add(r);
			}
			const w = pickWings(k, used, "pair");
			if (!w) return null;
			return [...out, ...w];
		}
		case "four_two": {
			const f = take(play.rank, 4);
			if (!f) return null;
			const used = /* @__PURE__ */ new Set([play.rank]);
			const pw = pickWings(2, used, "pair");
			if (pw) return [...f, ...pw];
			const sw = pickWings(2, used, "single");
			if (sw) return [...f, ...sw];
			return null;
		}
		case "four_pair_two": {
			const f = take(play.rank, 4);
			if (!f) return null;
			const used = /* @__PURE__ */ new Set([play.rank]);
			const w1 = pickWings(2, used, "pair");
			if (!w1) return null;
			const w2 = pickWings(2, used, "pair");
			if (!w2) return null;
			return [
				...f,
				...w1,
				...w2
			];
		}
		case "bomb": return take(play.rank, 4);
		case "rocket": {
			const sj = hand.find((c) => c.r === 13);
			const bj = hand.find((c) => c.r === 14);
			return sj && bj ? [sj, bj] : null;
		}
	}
}
/**
* 提示：从手牌中找一手"能压过 last 的最小牌"。
* - last 为空（领出）：尽可能甩出更长的顺子/飞机，其次三带/对子/单张（简单贪心）。
* - last 非空：升序找第一手能压过的牌；实在不行返回 null（表示该过）。
*/
function hintPlay(hand, last) {
	if (!last) {
		for (const kind of [
			"airplane",
			"pair_straight",
			"straight",
			"airplane_pair",
			"airplane_single",
			"triple_pair",
			"triple_one",
			"triple",
			"pair",
			"single"
		]) {
			const plays = legalPlays(hand, null).filter((p) => p.kind === kind).sort((a, b) => b.length - a.length || b.rank - a.rank);
			for (const p of plays) {
				const c = buildPlay(hand, p);
				if (c) return c;
			}
		}
		return null;
	}
	const plays = legalPlays(hand, last).sort((a, b) => strengthOf(a) - strengthOf(b));
	for (const p of plays) {
		const c = buildPlay(hand, p);
		if (c) return c;
	}
	return null;
}
/** 牌型强度（越小越容易先出），用于提示/机器人排序 */
function strengthOf(p) {
	return [
		"single",
		"pair",
		"triple",
		"triple_one",
		"triple_pair",
		"straight",
		"pair_straight",
		"airplane",
		"airplane_single",
		"airplane_pair",
		"four_two",
		"four_pair_two",
		"bomb",
		"rocket"
	].indexOf(p.kind) * 100 + p.rank;
}
//#endregion
//#region src/client/brandAssets.ts
const deepseekBlueUrl = "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/PjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+PHN2ZyB0PSIxNzg3MDE4MDYyNzMyIiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEzOTEgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAtaWQ9IjI0ODgiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iMjcxLjY3OTY4NzUiIGhlaWdodD0iMjAwIj48cGF0aCBkPSJNMTI5OS43MTg3Mzk0OCAxMDkuMDgxNjQ4NTJjLTEyLjk0Njc2MzU2LTYuNDc0ODU0NjgtMTguNTM2NDA3MjEgNS44NjY1NDgyNy0yNi4wOTk3MzI2OCAxMi4xMzgxNDMxNy0yLjU3NzU2OTUzIDIuMDIzNzYwMzEtNC43NzgwNzc0NyA0LjY1NDM1NDEzLTYuOTc4NTg1NCA3LjA4MTY4ODE5LTE4LjkxNzg4NzUxIDIwLjYzNTI4NTI2LTQxLjAyMDE3ODA1IDM0LjE5MTgyODEyLTY5LjkyNzI1MjE5IDMyLjU3MzExNDQ1LTQyLjIzMzg0NTA4LTIuNDI3MzM0MDUtNzguMjk3NzI1MTMgMTEuMTI3NzM1OTEtMTEwLjE2Mzg0OTA4IDQ0LjEwNTg5NzAxLTYuNzc2Nzk4NTMtNDAuNjY2NjgyODItMjkuMjg1NjA4NjItNjQuOTQ0NDQyMDMtNjMuNTUyNTU0NDgtODAuNTIzMjcyMy0xNy45NTYwODU4My04LjA5MjA5NTQ1LTM2LjA2Mzg4MDA1LTE2LjE4NTY2MzgtNDguNjMzNTgyMDItMzMuNzg4MjU0MzgtOC43NDkwMDc0Ni0xMi41NDMxODk4LTExLjEyNzczNTkxLTI2LjUwMzMwNjQxLTE1LjUyNzI3ODg5LTQwLjI2MDE2MzI2LTIuNzgyMzAyMi04LjI5NTM1NTIyLTUuNTY0NjA0NDItMTYuNzkyNDk3MzEtMTQuOTIwNDQ1MzctMTguMjA5NDI0MTItMTAuMTkyNDQ2MzktMS42MTg3MTM2Ny0xNC4xNjMzNzYzNyA3LjA4MTY4ODE4LTE4LjE1OTM0NTYxIDE0LjM2NTE2MzI1LTE1LjkzMjMyNTUzIDI5Ljc0MDczMzc2LTIyLjEyODgwMjY5IDYyLjUxNzEwNzk5LTIxLjQ5NjkyOTkzIDk1LjY5NzA1NTk2IDEuMzY2ODQ4MzEgNzQuNjU2NzI0MDQgMzIuMjcxMTcwNTkgMTM0LjEzODE5MTU2IDkzLjYyNDY5MDAzIDE3Ni40MjM1ODgwNCA2Ljk4MDA1ODMgNC44NTQ2NjgxIDguNzc1NTE5NTkgOS43MTA4MDkxMiA2LjU3NTAxMTY3IDE2Ljc5MTAyNDQtNC4xNzI3MTY4NiAxNC41NjY5NTAxMS05LjE4MDU2NjI0IDI4LjczMDMyNjUtMTMuNTU1MDY5OTYgNDMuMjk3Mjc2NjMtMi43ODM3NzUwOSA5LjMwNzIzNTM3LTYuOTU1MDE5MDYgMTEuMzI5NTIyNzgtMTYuNzQyNDE4ODIgNy4yODM0NzUwNi0zMy42NjE1ODUyNC0xNC4zNjUxNjMyNS02Mi43NDU0MDctMzUuNjA4NzU0OTEtODguNDY1MTMyMjctNjEuMzAxOTY4MDUtNDMuNjI0MjU5NzMtNDMuMDk1NDg5NzUtODMuMDc3Mjc1NS05MC42NDA2MDA5Ny0xMzIuMjY2MTM5NjUtMTI3Ljg2NjU5NjY4YTU4MS42NzA1NDM0MyA1ODEuNjcwNTQzNDMgMCAwIDAtMzUuMDc3MDM5MTUtMjQuNDgxMDE5Yy01MC4yMDA3NDQyOS00OS43NzA2NTg0MSA2LjU3NTAxMTY3LTkwLjYzOTEyODA3IDE5LjcyNjUwNzg3LTk1LjQ5NTI2OTA4IDEzLjczMTgxNzU5LTUuMDU3OTI3ODggNC43Nzk1NTAzNy0yMi40NTcyNTg3LTM5LjY1NDgwMjYxLTIyLjI1NTQ3MTgzcy04NS4wNzU5OTY1NSAxNS4zNzcwNDM0LTEzNi44NzA0MTUyOSAzNS42MDg3NTQ5MmMtNy41ODU0MTg5MiAzLjAzNDE2NzU2LTE1LjU1Mzc5MTAzIDUuMjU5NzE0NzUtMjMuNjk1OTY0OTcgNy4wODE2ODgxOS00Ny4wMzk5MDc1OS05LjEwNTQ0ODQ5LTk1Ljg0ODc2NDM0LTExLjEyNzczNTkxLTE0Ni44NTk2MDE4OC01LjI2MTE4NzY0LTk2LjAyNTUxMTk1IDEwLjkyNTk0OTA1LTE3Mi43MzEwMzU1NSA1Ny4yNTczOTMyMy0yMjkuMTI2Nzg0MTQgMTM2LjM2MzczODc1LTY3LjcyNjc0NDI1IDk1LjA5MDIyMjQ0LTgzLjY4NTU4MTkyIDIwMy4xMzAxNTQyMi02NC4xMzU4MjE2NiAzMTUuODIxNDk0MzMgMjAuNDg1MDQ5NzggMTE4Ljc2MjYyMTA3IDc5Ljg4OTkyNjY2IDIxNy4wOTAyNzA4NCAxNzEuMTM3MzYxMTYgMjkzLjk3MTA2OTIgOTQuNjM1MDk3MyA3OS43MTMxNzkwMiAyMDMuNjEwMzE4NjIgMTE4Ljc2MjYyMTA3IDMyNy45MzYwNzExNSAxMTEuMjc3MzU5MTIgNzUuNTE1NDIyOTItNC40NTI1NjcyNSAxNTkuNTc5NTM5MzQtMTQuNzcwMjA5ODkgMjU0LjQxNjQyMzUyLTk2LjcxMDQwOTAxIDIzLjkyNDI2Mzk5IDEyLjEzOTYxNjA3IDQ5LjAzNzE1NTc0IDE2Ljk5NTc1NzA4IDkwLjY2NTY0MDIyIDIwLjYzNjc1ODE1IDMyLjA5Mjk1MDA3IDMuMDM0MTY3NTYgNjIuOTcyMjMzMTEtMS42MTg3MTM2NyA4Ni44NzE0NTc4Ny02LjY3NjY0MTUyIDM3LjQ1NDI5NDcxLTguMDkyMDk1NDUgMzQuODQ4NzQwMTMtNDMuNDk5MDYzNDkgMjEuMzE4NzA5NC00OS45NzI0NDUyOC0xMDkuNzgzODQxNy01Mi4xOTk0NjUzNS04NS42ODI4MzAwOS0zMC45NTU4NzM2Ny0xMDcuNTgzMzMzNzUtNDguMTUxOTQ0NzQgNTUuNzg4OTE1MDQtNjcuMzczMjQ4OTkgMTM5Ljg1MzAzMTQ2LTEzNy4zNzcwOTE4IDE3Mi43MzEwMzU1OC0zNjQuMTc2Njk4ODcgMi42MDQwODE2Ny0xOC4wMDYxNjQzMyAwLjQwMzU3Mzc1LTI5LjMzNTY4NzExIDAtNDMuOTAyNjM3MjMtMC4yMDMyNTk3Ny04LjkwMjE4ODczIDEuNzY4OTQ5MTQtMTIuMzQyODc1ODQgMTEuNzU5NjA4NjgtMTMuMzUzMjgzMSAyNy40OTAxNDczMy0zLjIzNzQyNzMzIDU0LjE5NjcxMzUxLTEwLjkyNTk0OTA1IDc4LjcwMjc3MTc1LTI0LjY4MjgwNTg3IDcxLjExNDQwNzA2LTM5LjY1NDgwMjY1IDk5LjgxODIyMTQyLTEwNC44MDI1MDQ0NiAxMDYuNTk2NDkyODUtMTgyLjg5ODQ0MjcxIDEuMDExODgwMTUtMTEuOTM2MzU2My0wLjIwMTc4Njg2LTI0LjI3Nzc1OTI0LTEyLjU2OTcwMTk1LTMwLjU0OTM1NDE1TTY3OS44ODY5MTA4MyA4MTEuOTQwNjc0MThjLTEwNi4zNjk2NjY3My04NS4zNzk0MTMzMy0xNTcuOTg3MzM3ODItMTEzLjUwMTQzMzQtMTc5LjMwNjA0NzIzLTExMi4yODc3NjYzOC0xOS45MjgyOTQ3NiAxLjIxMzY2NzAzLTE2LjMzNzM3MjE3IDI0LjQ4MTAxOTAyLTExLjk2Mjg2ODQ1IDM5LjY1NDgwMjYzIDQuNTc3NzYzNSAxNC45NzE5OTY3NyAxMC41NzA5ODA4OSAyNS4yODk2Mzk0IDE4Ljk0MTQ1Mzg4IDM4LjQ0MTEzNTYzIDUuNzY3ODY0MTcgOC43MDA0MDE4NiA5Ljc2MzgzMzQxIDIxLjY0ODYzODMxLTUuNzg5OTU3NjQgMzEuMzU5NDQ3NDItMzQuMjY4NDE4NzYgMjEuNjQ4NjM4MzEtOTMuODI2NDc2OTItNy4yODM0NzUwNi05Ni42MDczMDYyMy04LjY5ODkyODk3LTY5LjM0NTQ1NzktNDEuNjc4NTYyOTUtMTI3LjMzNjM1Mzc4LTk2LjcxMDQwOS0xNjguMTc5Nzg0MjMtMTcxLjk3MjQ5MzY3LTM5LjQ1MTU0Mjg4LTcyLjQzMTE3Njg3LTYyLjMzODg4NzQ3LTE1MC4xMjIwNjg1LTY2LjEzMzA2OTgyLTIzMy4wNzI2NzQ4NC0xLjAxMTg4MDE1LTIwLjAyOTkyNDY0IDQuNzc5NTUwMzctMjcuMTExNjEyODIgMjQuMjc5MjMyMTUtMzAuNzU0MDg2ODNhMjM1LjE5NjU5MjE2IDIzNS4xOTY1OTIxNiAwIDAgMSA3Ny45MTc3MTc3Ni0yLjAyMjI4NzRjMTA4LjU5NjY4NjgxIDE2LjE4NzEzNjY5IDIwMS4wNTYzMTU0MiA2NS43NTQ1MzUzMSAyNzguNTQzOTQ3MjUgMTQ0LjI1NTUyMDIyIDQ0LjIzMjU2NjE0IDQ0LjcxMTI1NzYyIDc3LjY5MDg5MTYzIDk4LjEyNDM5MDAxIDExMi4xODYxMzY0OSAxNTAuMzIzODU1MzYgMzYuNjQ1Njc0MzEgNTUuNDMzOTQ2OTEgNzYuMDk4NjkwMSAxMDguMjQwMjQ1NzYgMTI2LjI5OTQzNDQgMTUxLjUzNjA0OTQ4IDE3LjcyNzc4NjgyIDE1LjE3Mzc4MzY1IDMxLjg2NDY1MTA2IDI2LjcwNjU2NjIgNDUuNDE5NzIxMDEgMzUuMjAzNzA4MjgtNDAuODQzNDMwNDIgNC42NTQzNTQxMy0xMDguOTk4Nzg3NjUgNS42NjQ3NjEzOS0xNTUuNjA4NjA5MzQtMzEuOTY2MjgwOTNtNTEuMDA5MzY0NjgtMzM0LjgzOTUzODg0YzAtOC45MDIxODg3MyA2Ljk4MTUzMTItMTUuOTgzODc2OTMgMTUuNzU1NTc3ODgtMTUuOTgzODc2OTNxMi45ODQwODkwOCAwLjA1MTU1MTM4IDUuMzYxMzQ0NjUgMS4wMTE4ODAxNmExNS44NTcyMDc3OSAxNS44NTcyMDc3OSAwIDAgMSAxMC4xNjc0MDcxNiAxNC45NzE5OTY3NyAxNS43ODA2MTcxNSAxNS43ODA2MTcxNSAwIDAgMS0xNS43MzA1Mzg2NSAxNS45ODM4NzY5MiAxNS42MDM4Njk1MyAxNS42MDM4Njk1MyAwIDAgMS0xNS41NTM3OTEwNC0xNS45ODM4NzY5Mm0xNTguMzkyMzg0NDUgODIuOTUwNjA2MzZjLTEwLjE0MjM2NzkgNC4yNDkzMDc0OS0yMC4zMDgzMDIxNSA3Ljg5MTc4MTQ2LTMwLjA5NTcwMTg5IDguMjk1MzU1MjItMTUuMTIzNzA1MTQgMC44MTAwOTMyOC0zMS42NjI4NjQxOS01LjQ2MTUwMTYyLTQwLjYxNTEzMTQzLTEzLjE1MDAyMzMzLTEzLjk2MDExNjYxLTExLjkzNzgyOTE5LTIzLjkyNTczNjg5LTE4LjYxNDQ3MDczLTI4LjA5ODQ1MzczLTM5LjQ1MzAxNTc3LTEuNzk1NDYxMjktOC45MDIxODg3My0wLjgxMDA5MzI4LTIyLjY1OTA0NTU3IDAuNzg1MDU0MDQtMzAuNTQ5MzU0MTQgMy41OTA5MjI1OC0xNi45OTU3NTcwOC0wLjQwNTA0NjY1LTI3LjkyMDIzMzIxLTEyLjEzOTYxNjA3LTM3LjgzNDMwMjEtOS41NTkxMDA3NS04LjA5MzU2ODM1LTIxLjcyNTIyODk0LTEwLjMxOTExNTUzLTM1LjA3NzAzOTE1LTEwLjMxOTExNTUzLTQuOTgyODEwMTMgMC05LjU1OTEwMDc1LTIuMjI0MDc0MjktMTIuOTQ4MjM2NDYtNC4wNDYwNDc3MmExMy4yNzY2OTI0NiAxMy4yNzY2OTI0NiAwIDAgMS01Ljc2NjM5MTI2LTE4LjYxMjk5Nzg1YzEuMzkwNDE0NjYtMi44MzIzODA3IDguMTY4Njg2MDgtOS43MTIyODIwMiA5Ljc2MjM2MDQ5LTEwLjkyNTk0OTAzIDE4LjEzMTM2MDU4LTEwLjUyMDkwMjQxIDM5LjA0NjQ5NjIzLTcuMDgwMjE1MjkgNTguMzY3OTU3NDcgMC44MTAwOTMyOCAxNy45MzEwNDY1OSA3LjQ4NTI2MTk0IDMxLjQ2MTA3NzMxIDIxLjI0MzU5MTY3IDUxLjAxMDgzNzU5IDQwLjY2NjY4Mjc4IDE5LjkyODI5NDc2IDIzLjQ2OTEzODg1IDIzLjUxOTIxNzMzIDI5Ljk0Mzk5MzUzIDM0Ljg0ODc0MDEyIDQ3LjU0NTExMTI0IDguOTc4Nzc5MzYgMTMuNzU2ODU2ODUgMTcuMTQ3NDY1NDUgMjcuOTIwMjMzMjEgMjIuNzEyMDY5ODUgNDQuMTA0NDI0MSAzLjQxMjcwMjA2IDEwLjExNzMyODY1LTAuOTg2ODQwOTEgMTguNDExMjEwOTctMTIuNzQ2NDQ5NTcgMjMuNDY5MTM4ODUiIGZpbGw9IiM0RDZCRkUiIHAtaWQ9IjI0ODkiPjwvcGF0aD48L3N2Zz4=";
const deepseekBlackUrl = "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/PjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+PHN2ZyB0PSIxNzg3MDE5Nzk5MjY5IiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEzOTEgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAtaWQ9IjE2NjgiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iMjcxLjY3OTY4NzUiIGhlaWdodD0iMjAwIj48cGF0aCBkPSJNMTI5OS43MTg3Mzk0OCAxMDkuMDgxNjQ4NTJjLTEyLjk0Njc2MzU2LTYuNDc0ODU0NjgtMTguNTM2NDA3MjEgNS44NjY1NDgyNy0yNi4wOTk3MzI2OCAxMi4xMzgxNDMxNy0yLjU3NzU2OTUzIDIuMDIzNzYwMzEtNC43NzgwNzc0NyA0LjY1NDM1NDEzLTYuOTc4NTg1NCA3LjA4MTY4ODE5LTE4LjkxNzg4NzUxIDIwLjYzNTI4NTI2LTQxLjAyMDE3ODA1IDM0LjE5MTgyODEyLTY5LjkyNzI1MjE5IDMyLjU3MzExNDQ1LTQyLjIzMzg0NTA4LTIuNDI3MzM0MDUtNzguMjk3NzI1MTMgMTEuMTI3NzM1OTEtMTEwLjE2Mzg0OTA4IDQ0LjEwNTg5NzAxLTYuNzc2Nzk4NTMtNDAuNjY2NjgyODItMjkuMjg1NjA4NjItNjQuOTQ0NDQyMDMtNjMuNTUyNTU0NDgtODAuNTIzMjcyMy0xNy45NTYwODU4My04LjA5MjA5NTQ1LTM2LjA2Mzg4MDA1LTE2LjE4NTY2MzgtNDguNjMzNTgyMDItMzMuNzg4MjU0MzgtOC43NDkwMDc0Ni0xMi41NDMxODk4LTExLjEyNzczNTkxLTI2LjUwMzMwNjQxLTE1LjUyNzI3ODg5LTQwLjI2MDE2MzI2LTIuNzgyMzAyMi04LjI5NTM1NTIyLTUuNTY0NjA0NDItMTYuNzkyNDk3MzEtMTQuOTIwNDQ1MzctMTguMjA5NDI0MTItMTAuMTkyNDQ2MzktMS42MTg3MTM2Ny0xNC4xNjMzNzYzNyA3LjA4MTY4ODE4LTE4LjE1OTM0NTYxIDE0LjM2NTE2MzI1LTE1LjkzMjMyNTUzIDI5Ljc0MDczMzc2LTIyLjEyODgwMjY5IDYyLjUxNzEwNzk5LTIxLjQ5NjkyOTkzIDk1LjY5NzA1NTk2IDEuMzY2ODQ4MzEgNzQuNjU2NzI0MDQgMzIuMjcxMTcwNTkgMTM0LjEzODE5MTU2IDkzLjYyNDY5MDAzIDE3Ni40MjM1ODgwNCA2Ljk4MDA1ODMgNC44NTQ2NjgxIDguNzc1NTE5NTkgOS43MTA4MDkxMiA2LjU3NTAxMTY3IDE2Ljc5MTAyNDQtNC4xNzI3MTY4NiAxNC41NjY5NTAxMS05LjE4MDU2NjI0IDI4LjczMDMyNjUtMTMuNTU1MDY5OTYgNDMuMjk3Mjc2NjMtMi43ODM3NzUwOSA5LjMwNzIzNTM3LTYuOTU1MDE5MDYgMTEuMzI5NTIyNzgtMTYuNzQyNDE4ODIgNy4yODM0NzUwNi0zMy42NjE1ODUyNC0xNC4zNjUxNjMyNS02Mi43NDU0MDctMzUuNjA4NzU0OTEtODguNDY1MTMyMjctNjEuMzAxOTY4MDUtNDMuNjI0MjU5NzMtNDMuMDk1NDg5NzUtODMuMDc3Mjc1NS05MC42NDA2MDA5Ny0xMzIuMjY2MTM5NjUtMTI3Ljg2NjU5NjY4YTU4MS42NzA1NDM0MyA1ODEuNjcwNTQzNDMgMCAwIDAtMzUuMDc3MDM5MTUtMjQuNDgxMDE5Yy01MC4yMDA3NDQyOS00OS43NzA2NTg0MSA2LjU3NTAxMTY3LTkwLjYzOTEyODA3IDE5LjcyNjUwNzg3LTk1LjQ5NTI2OTA4IDEzLjczMTgxNzU5LTUuMDU3OTI3ODggNC43Nzk1NTAzNy0yMi40NTcyNTg3LTM5LjY1NDgwMjYxLTIyLjI1NTQ3MTgzcy04NS4wNzU5OTY1NSAxNS4zNzcwNDM0LTEzNi44NzA0MTUyOSAzNS42MDg3NTQ5MmMtNy41ODU0MTg5MiAzLjAzNDE2NzU2LTE1LjU1Mzc5MTAzIDUuMjU5NzE0NzUtMjMuNjk1OTY0OTcgNy4wODE2ODgxOS00Ny4wMzk5MDc1OS05LjEwNTQ0ODQ5LTk1Ljg0ODc2NDM0LTExLjEyNzczNTkxLTE0Ni44NTk2MDE4OC01LjI2MTE4NzY0LTk2LjAyNTUxMTk1IDEwLjkyNTk0OTA1LTE3Mi43MzEwMzU1NSA1Ny4yNTczOTMyMy0yMjkuMTI2Nzg0MTQgMTM2LjM2MzczODc1LTY3LjcyNjc0NDI1IDk1LjA5MDIyMjQ0LTgzLjY4NTU4MTkyIDIwMy4xMzAxNTQyMi02NC4xMzU4MjE2NiAzMTUuODIxNDk0MzMgMjAuNDg1MDQ5NzggMTE4Ljc2MjYyMTA3IDc5Ljg4OTkyNjY2IDIxNy4wOTAyNzA4NCAxNzEuMTM3MzYxMTYgMjkzLjk3MTA2OTIgOTQuNjM1MDk3MyA3OS43MTMxNzkwMiAyMDMuNjEwMzE4NjIgMTE4Ljc2MjYyMTA3IDMyNy45MzYwNzExNSAxMTEuMjc3MzU5MTIgNzUuNTE1NDIyOTItNC40NTI1NjcyNSAxNTkuNTc5NTM5MzQtMTQuNzcwMjA5ODkgMjU0LjQxNjQyMzUyLTk2LjcxMDQwOTAxIDIzLjkyNDI2Mzk5IDEyLjEzOTYxNjA3IDQ5LjAzNzE1NTc0IDE2Ljk5NTc1NzA4IDkwLjY2NTY0MDIyIDIwLjYzNjc1ODE1IDMyLjA5Mjk1MDA3IDMuMDM0MTY3NTYgNjIuOTcyMjMzMTEtMS42MTg3MTM2NyA4Ni44NzE0NTc4Ny02LjY3NjY0MTUyIDM3LjQ1NDI5NDcxLTguMDkyMDk1NDUgMzQuODQ4NzQwMTMtNDMuNDk5MDYzNDkgMjEuMzE4NzA5NC00OS45NzI0NDUyOC0xMDkuNzgzODQxNy01Mi4xOTk0NjUzNS04NS42ODI4MzAwOS0zMC45NTU4NzM2Ny0xMDcuNTgzMzMzNzUtNDguMTUxOTQ0NzQgNTUuNzg4OTE1MDQtNjcuMzczMjQ4OTkgMTM5Ljg1MzAzMTQ2LTEzNy4zNzcwOTE4IDE3Mi43MzEwMzU1OC0zNjQuMTc2Njk4ODcgMi42MDQwODE2Ny0xOC4wMDYxNjQzMyAwLjQwMzU3Mzc1LTI5LjMzNTY4NzExIDAtNDMuOTAyNjM3MjMtMC4yMDMyNTk3Ny04LjkwMjE4ODczIDEuNzY4OTQ5MTQtMTIuMzQyODc1ODQgMTEuNzU5NjA4NjgtMTMuMzUzMjgzMSAyNy40OTAxNDczMy0zLjIzNzQyNzMzIDU0LjE5NjcxMzUxLTEwLjkyNTk0OTA1IDc4LjcwMjc3MTc1LTI0LjY4MjgwNTg3IDcxLjExNDQwNzA2LTM5LjY1NDgwMjY1IDk5LjgxODIyMTQyLTEwNC44MDI1MDQ0NiAxMDYuNTk2NDkyODUtMTgyLjg5ODQ0MjcxIDEuMDExODgwMTUtMTEuOTM2MzU2My0wLjIwMTc4Njg2LTI0LjI3Nzc1OTI0LTEyLjU2OTcwMTk1LTMwLjU0OTM1NDE1TTY3OS44ODY5MTA4MyA4MTEuOTQwNjc0MThjLTEwNi4zNjk2NjY3My04NS4zNzk0MTMzMy0xNTcuOTg3MzM3ODItMTEzLjUwMTQzMzQtMTc5LjMwNjA0NzIzLTExMi4yODc3NjYzOC0xOS45MjgyOTQ3NiAxLjIxMzY2NzAzLTE2LjMzNzM3MjE3IDI0LjQ4MTAxOTAyLTExLjk2Mjg2ODQ1IDM5LjY1NDgwMjYzIDQuNTc3NzYzNSAxNC45NzE5OTY3NyAxMC41NzA5ODA4OSAyNS4yODk2Mzk0IDE4Ljk0MTQ1Mzg4IDM4LjQ0MTEzNTYzIDUuNzY3ODY0MTcgOC43MDA0MDE4NiA5Ljc2MzgzMzQxIDIxLjY0ODYzODMxLTUuNzg5OTU3NjQgMzEuMzU5NDQ3NDItMzQuMjY4NDE4NzYgMjEuNjQ4NjM4MzEtOTMuODI2NDc2OTItNy4yODM0NzUwNi05Ni42MDczMDYyMy04LjY5ODkyODk3LTY5LjM0NTQ1NzktNDEuNjc4NTYyOTUtMTI3LjMzNjM1Mzc4LTk2LjcxMDQwOS0xNjguMTc5Nzg0MjMtMTcxLjk3MjQ5MzY3LTM5LjQ1MTU0Mjg4LTcyLjQzMTE3Njg3LTYyLjMzODg4NzQ3LTE1MC4xMjIwNjg1LTY2LjEzMzA2OTgyLTIzMy4wNzI2NzQ4NC0xLjAxMTg4MDE1LTIwLjAyOTkyNDY0IDQuNzc5NTUwMzctMjcuMTExNjEyODIgMjQuMjc5MjMyMTUtMzAuNzU0MDg2ODNhMjM1LjE5NjU5MjE2IDIzNS4xOTY1OTIxNiAwIDAgMSA3Ny45MTc3MTc3Ni0yLjAyMjI4NzRjMTA4LjU5NjY4NjgxIDE2LjE4NzEzNjY5IDIwMS4wNTYzMTU0MiA2NS43NTQ1MzUzMSAyNzguNTQzOTQ3MjUgMTQ0LjI1NTUyMDIyIDQ0LjIzMjU2NjE0IDQ0LjcxMTI1NzYyIDc3LjY5MDg5MTYzIDk4LjEyNDM5MDAxIDExMi4xODYxMzY0OSAxNTAuMzIzODU1MzYgMzYuNjQ1Njc0MzEgNTUuNDMzOTQ2OTEgNzYuMDk4NjkwMSAxMDguMjQwMjQ1NzYgMTI2LjI5OTQzNDQgMTUxLjUzNjA0OTQ4IDE3LjcyNzc4NjgyIDE1LjE3Mzc4MzY1IDMxLjg2NDY1MTA2IDI2LjcwNjU2NjIgNDUuNDE5NzIxMDEgMzUuMjAzNzA4MjgtNDAuODQzNDMwNDIgNC42NTQzNTQxMy0xMDguOTk4Nzg3NjUgNS42NjQ3NjEzOS0xNTUuNjA4NjA5MzQtMzEuOTY2MjgwOTNtNTEuMDA5MzY0NjgtMzM0LjgzOTUzODg0YzAtOC45MDIxODg3MyA2Ljk4MTUzMTItMTUuOTgzODc2OTMgMTUuNzU1NTc3ODgtMTUuOTgzODc2OTNxMi45ODQwODkwOCAwLjA1MTU1MTM4IDUuMzYxMzQ0NjUgMS4wMTE4ODAxNmExNS44NTcyMDc3OSAxNS44NTcyMDc3OSAwIDAgMSAxMC4xNjc0MDcxNiAxNC45NzE5OTY3NyAxNS43ODA2MTcxNSAxNS43ODA2MTcxNSAwIDAgMS0xNS43MzA1Mzg2NSAxNS45ODM4NzY5MiAxNS42MDM4Njk1MyAxNS42MDM4Njk1MyAwIDAgMS0xNS41NTM3OTEwNC0xNS45ODM4NzY5Mm0xNTguMzkyMzg0NDUgODIuOTUwNjA2MzZjLTEwLjE0MjM2NzkgNC4yNDkzMDc0OS0yMC4zMDgzMDIxNSA3Ljg5MTc4MTQ2LTMwLjA5NTcwMTg5IDguMjk1MzU1MjItMTUuMTIzNzA1MTQgMC44MTAwOTMyOC0zMS42NjI4NjQxOS01LjQ2MTUwMTYyLTQwLjYxNTEzMTQzLTEzLjE1MDAyMzMzLTEzLjk2MDExNjYxLTExLjkzNzgyOTE5LTIzLjkyNTczNjg5LTE4LjYxNDQ3MDczLTI4LjA5ODQ1MzczLTM5LjQ1MzAxNTc3LTEuNzk1NDYxMjktOC45MDIxODg3My0wLjgxMDA5MzI4LTIyLjY1OTA0NTU3IDAuNzg1MDU0MDQtMzAuNTQ5MzU0MTQgMy41OTA5MjI1OC0xNi45OTU3NTcwOC0wLjQwNTA0NjY1LTI3LjkyMDIzMzIxLTEyLjEzOTYxNjA3LTM3LjgzNDMwMjEtOS41NTkxMDA3NS04LjA5MzU2ODM1LTIxLjcyNTIyODk0LTEwLjMxOTExNTUzLTM1LjA3NzAzOTE1LTEwLjMxOTExNTUzLTQuOTgyODEwMTMgMC05LjU1OTEwMDc1LTIuMjI0MDc0MjktMTIuOTQ4MjM2NDYtNC4wNDYwNDc3MmExMy4yNzY2OTI0NiAxMy4yNzY2OTI0NiAwIDAgMS01Ljc2NjM5MTI2LTE4LjYxMjk5Nzg1YzEuMzkwNDE0NjYtMi44MzIzODA3IDguMTY4Njg2MDgtOS43MTIyODIwMiA5Ljc2MjM2MDQ5LTEwLjkyNTk0OTAzIDE4LjEzMTM2MDU4LTEwLjUyMDkwMjQxIDM5LjA0NjQ5NjIzLTcuMDgwMjE1MjkgNTguMzY3OTU3NDcgMC44MTAwOTMyOCAxNy45MzEwNDY1OSA3LjQ4NTI2MTk0IDMxLjQ2MTA3NzMxIDIxLjI0MzU5MTY3IDUxLjAxMDgzNzU5IDQwLjY2NjY4Mjc4IDE5LjkyODI5NDc2IDIzLjQ2OTEzODg1IDIzLjUxOTIxNzMzIDI5Ljk0Mzk5MzUzIDM0Ljg0ODc0MDEyIDQ3LjU0NTExMTI0IDguOTc4Nzc5MzYgMTMuNzU2ODU2ODUgMTcuMTQ3NDY1NDUgMjcuOTIwMjMzMjEgMjIuNzEyMDY5ODUgNDQuMTA0NDI0MSAzLjQxMjcwMjA2IDEwLjExNzMyODY1LTAuOTg2ODQwOTEgMTguNDExMjEwOTctMTIuNzQ2NDQ5NTcgMjMuNDY5MTM4ODUiIGZpbGw9IiMyYzJjMmMiIHAtaWQ9IjE2NjkiPjwvcGF0aD48L3N2Zz4=";
//#endregion
//#region shared/protocol.ts
/** 应用版本（须与根 package.json version 同步） */
const APP_VERSION = "0.3.0";
//#endregion
//#region src/client/api.ts
/**
* src/client/api.ts —— M2 云端 API / WebSocket 客户端
* 基地址默认线上 Worker；可用 localStorage 'ddz:api' 覆盖（本地联调用 http://127.0.0.1:8787）
*/
const DEFAULT_API = "https://dsh-doudizhu.1546567314.workers.dev";
function apiBase() {
	return (localStorage.getItem("ddz:api") ?? DEFAULT_API).replace(/\/+$/, "");
}
function authToken() {
	return localStorage.getItem("ddz:token");
}
/** 服务器健康/版本信息（进入在线模式前做协议兼容性检查） */
function health() {
	return req("/api/health");
}
async function req(path, init = {}) {
	const token = authToken();
	const res = await fetch(apiBase() + path, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...token ? { Authorization: `Bearer ${token}` } : {},
			...init.headers ?? {}
		}
	});
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
	return data;
}
/** 换取 token（服务端同时建档） */
async function auth(uid) {
	const r = await req("/api/auth", {
		method: "POST",
		body: JSON.stringify({ uid })
	});
	localStorage.setItem("ddz:token", r.token);
	return r;
}
function getMe() {
	return req("/api/me");
}
function updateProfile(nickname, avatarId) {
	return req("/api/me/profile", {
		method: "PUT",
		body: JSON.stringify({
			nickname,
			avatarId
		})
	});
}
function claimDaily() {
	return req("/api/daily", { method: "POST" });
}
/** 破产救济（每日一次，余额低于最低桌门槛时可领） */
function rescue() {
	return req("/api/rescue", { method: "POST" });
}
function joinQueue(tableId) {
	return req("/api/lobby/queue", {
		method: "POST",
		body: JSON.stringify({ tableId })
	});
}
function pollQueue(tableId) {
	return req(`/api/lobby/status?tableId=${encodeURIComponent(tableId)}`);
}
function leaveQueue(tableId) {
	return req("/api/lobby/queue", {
		method: "DELETE",
		body: JSON.stringify({ tableId })
	});
}
/** 连接对局房间 WebSocket（token/协议/应用版本走查询参数，浏览器可行） */
function connectRoom(roomId) {
	const base = apiBase().replace(/^http/, "ws");
	const token = authToken();
	const params = new URLSearchParams({
		token: token ?? "",
		protocol: String(2),
		app: APP_VERSION
	});
	return new WebSocket(`${base}/ws/room/${encodeURIComponent(roomId)}?${params.toString()}`);
}
//#endregion
//#region src/client/table-view.ts
/** 线上 WS 状态 → 视图 */
function tableViewFromProtocol(p) {
	const asCard = (c) => ({
		r: c.r,
		s: c.s
	});
	return {
		phase: p.phase,
		mySeat: p.seat,
		myHand: p.hand.map(asCard),
		bottom: p.bottom.map(asCard),
		landlord: p.landlord,
		hasCalled: p.hasCalled,
		current: p.current,
		callOrder: p.callOrder.map((s) => s),
		callActor: p.callActor,
		callMultiplier: p.callMultiplier,
		callerSeat: p.callerSeat,
		robOrder: p.robOrder.map((s) => s),
		robActor: p.robActor,
		doublingOrder: p.doublingOrder.map((s) => s),
		doublingActor: p.doublingActor,
		doubled: p.doubled,
		revealed: p.revealed,
		dealRound: p.dealRound,
		lastPlayCards: p.lastPlayCards ? p.lastPlayCards.map(asCard) : null,
		lastActor: p.lastActor,
		multiplier: p.multiplier,
		bombCount: p.bombCount,
		landlordPlays: p.landlordPlays,
		spring: p.spring,
		finished: p.finished,
		winner: p.winner,
		seats: p.seats.map((s) => ({
			seat: s.seat,
			nickname: s.nickname,
			avatarId: s.avatarId,
			handCount: s.count,
			role: s.role,
			connected: s.connected,
			tokenBalance: s.tokenBalance,
			isHuman: s.seat === p.seat,
			hand: s.hand ? sortHand(s.hand.map(asCard)) : void 0
		})),
		turnStartedAt: p.turnStartedAt,
		turnTimeoutMs: p.turnTimeoutMs
	};
}
//#endregion
//#region src/client/action-feedback.ts
function snapshotOf(view) {
	return {
		phase: view.phase,
		callActor: view.callActor,
		hasCalled: view.hasCalled,
		callMultiplier: view.callMultiplier,
		robActor: view.robActor,
		doublingActor: view.doublingActor,
		doubled: [...view.doubled],
		current: view.current,
		lastActor: view.lastActor
	};
}
/** 由相邻两次状态推进推断刚刚发生的行动；无法确定时返回 null */
function inferAction(prev, view) {
	if (view.phase === "settled") return null;
	if (prev.phase === "calling" && view.phase === "robbing" && view.hasCalled && !prev.hasCalled && view.callerSeat !== null) return {
		seat: view.callerSeat,
		text: "叫地主"
	};
	if (view.callActor > prev.callActor && view.callActor > 0 && view.callActor <= 3) {
		const acted = view.callOrder[view.callActor - 1];
		if (acted === void 0) return null;
		return {
			seat: acted,
			text: "不叫"
		};
	}
	if (view.robActor > prev.robActor && view.robActor > 0 && view.robActor <= 3) {
		const acted = view.robOrder[view.robActor - 1];
		if (acted === void 0) return null;
		return {
			seat: acted,
			text: view.callMultiplier > prev.callMultiplier ? "抢地主" : "不抢"
		};
	}
	if (view.doublingActor > prev.doublingActor && view.doublingActor > 0 && view.doublingActor <= 3) {
		const acted = view.doublingOrder[view.doublingActor - 1];
		if (acted === void 0) return null;
		const choice = view.doubled[acted];
		return {
			seat: acted,
			text: choice === 2 ? "超级加倍" : choice === 1 ? "加倍" : "不加倍"
		};
	}
	if (view.phase === "playing" && prev.phase === "playing" && view.current !== prev.current && view.lastActor !== null && view.lastActor === prev.lastActor && (view.current + 2) % 3 !== view.lastActor) return {
		seat: (view.current + 2) % 3,
		text: "过"
	};
	return null;
}
//#endregion
//#region src/client/App.tsx
/**
* dsh-doudizhu 客户端主界面（在线 PVP，真人不足时机器人补位）
* - 侧边栏入口 + 独立斗地主工作区 + 可调整画中画小窗
* - 大厅：昵称/头像/段位/余额、每日签到、桌别选择、匹配（15s 自动补机器人）
* - 牌桌（线上 PVP）：叫地主/抢地主 → 出牌/过/提示 → 结算
* - 经济：服务端权威记账（Cloudflare Worker）
*/
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
`;
function CardView({ card, selected, onClick, size = "normal" }) {
	const isJoker = card.r >= 13;
	const isRed = isJoker ? card.r === 14 : card.s === 1 || card.s === 2;
	const label = cardName(card);
	const sizeClass = size === "big" ? " ddz-card-big" : size === "mini" ? " ddz-card-mini" : "";
	if (isJoker) {
		const letters = "JOKER".split("");
		return (0, react.createElement)("div", {
			className: "ddz-card ddz-joker-card" + (isRed ? " red" : "") + (selected ? " sel" : "") + sizeClass,
			role: onClick ? "button" : void 0,
			tabIndex: onClick ? 0 : void 0,
			"aria-label": onClick ? `选择${label}` : void 0,
			"aria-pressed": onClick ? selected : void 0,
			onClick,
			onKeyDown: onClick ? (event) => {
				if (event.key === "Enter" || event.key === " ") onClick();
			} : void 0
		}, (0, react.createElement)("span", {
			className: "ddz-joker-main",
			"aria-label": label
		}, ...letters.map((ch, i) => (0, react.createElement)("span", {
			key: i,
			className: "ddz-joker-letter"
		}, ch))));
	}
	const rank = RANK_NAMES[card.r];
	const suit = SUIT_SYMBOLS[card.s];
	const rankClass = rank.length > 1 ? " long" : "";
	return (0, react.createElement)("div", {
		className: "ddz-card" + (isRed ? " red" : "") + (selected ? " sel" : "") + sizeClass,
		role: onClick ? "button" : void 0,
		tabIndex: onClick ? 0 : void 0,
		"aria-label": onClick ? `选择${label}` : void 0,
		"aria-pressed": onClick ? selected : void 0,
		onClick,
		onKeyDown: onClick ? (event) => {
			if (event.key === "Enter" || event.key === " ") onClick();
		} : void 0
	}, (0, react.createElement)("span", { className: "ddz-card-corner top" }, (0, react.createElement)("span", { className: "ddz-card-rank" + rankClass }, rank), (0, react.createElement)("span", { className: "ddz-card-suit" }, suit)), size !== "mini" && (0, react.createElement)("span", {
		className: "ddz-card-corner bottom",
		"aria-hidden": true
	}, (0, react.createElement)("span", { className: "ddz-card-suit" }, suit)));
}
function CardBack({ label = "未揭示底牌" }) {
	return (0, react.createElement)("div", {
		className: "ddz-card ddz-card-back",
		role: "img",
		"aria-label": label
	}, (0, react.createElement)("img", {
		src: deepseekBlackUrl,
		alt: ""
	}));
}
function Avatar({ avatarId, size = 40 }) {
	const blue = avatarId === "default-01" || avatarId === "default-01.svg";
	const cls = blue ? "blue" : "black";
	const src = blue ? deepseekBlueUrl : deepseekBlackUrl;
	return (0, react.createElement)("div", {
		className: `ddz-avatar ${cls}`,
		style: {
			width: size,
			height: size
		}
	}, (0, react.createElement)("img", {
		src,
		alt: "",
		draggable: false
	}));
}
function EditIcon() {
	return (0, react.createElement)("svg", {
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.8,
		strokeLinecap: "round",
		strokeLinejoin: "round",
		"aria-hidden": true
	}, (0, react.createElement)("path", { d: "M12 20h9" }), (0, react.createElement)("path", { d: "M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" }));
}
function CheckIcon() {
	return (0, react.createElement)("svg", {
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 2,
		strokeLinecap: "round",
		strokeLinejoin: "round",
		"aria-hidden": true
	}, (0, react.createElement)("path", { d: "m5 12 4 4L19 6" }));
}
function CloseIcon() {
	return (0, react.createElement)("svg", {
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 2,
		strokeLinecap: "round",
		"aria-hidden": true
	}, (0, react.createElement)("path", { d: "M6 6l12 12M18 6 6 18" }));
}
function formatTokenCount(value) {
	const abs = Math.abs(value);
	const unit = abs >= 1e9 ? "B" : abs >= 1e6 ? "M" : abs >= 1e3 ? "k" : "";
	const amount = value / (unit === "B" ? 1e9 : unit === "M" ? 1e6 : unit === "k" ? 1e3 : 1);
	if (!unit) return String(Math.round(value));
	return `${amount.toFixed(amount >= 100 ? 0 : 1).replace(/\.0$/, "")}${unit}`;
}
function PlayerRank({ tokenBalance }) {
	return (0, react.createElement)("div", { className: "ddz-seat-rank" }, rankForBalance(tokenBalance).name);
}
function RoleBadge({ role }) {
	const landlord = role === "landlord";
	return (0, react.createElement)("span", { className: "ddz-role-badge " + (landlord ? "ddz-landlord-badge" : "ddz-farmer-badge") }, landlord ? "地主" : "农民");
}
function PlayedArea({ seat, humanSeat = 0, cards, countdownSeconds = null, action = null }) {
	const cardKey = cards?.map((card) => `${card.r}-${card.s}`).join("|") ?? "empty";
	const play = cards ? classify(cards) : null;
	const isSpecialPlay = play !== null && ![
		"single",
		"pair",
		"triple"
	].includes(play.kind);
	const specialClass = isSpecialPlay && play ? ` ddz-special-play ddz-special-${play.kind}` : "";
	const actionClass = action ? action.text === "叫地主" || action.text === "抢地主" || action.text === "加倍" || action.text === "超级加倍" || action.text === "明牌" ? "" : " is-pass" : "";
	return (0, react.createElement)("div", {
		className: "ddz-play-area",
		"aria-label": `${seatLabel(seat, humanSeat)}出牌区${play ? `，${KIND_NAMES[play.kind]}` : ""}`
	}, action && (0, react.createElement)("div", {
		key: action.id,
		className: "ddz-play-area-action" + actionClass,
		role: "status",
		"aria-live": "polite"
	}, action.text), countdownSeconds !== null && (0, react.createElement)("span", {
		className: "ddz-countdown ddz-play-area-countdown" + (countdownSeconds <= 3 ? " urgent" : ""),
		"aria-live": "polite"
	}, `${countdownSeconds}s`), cards && cards.length > 0 ? (0, react.createElement)("div", {
		className: "ddz-play-area-cards ddz-folded-cards" + specialClass,
		key: cardKey
	}, ...cards.map((card, i) => (0, react.createElement)("div", {
		key: `${card.r}-${card.s}-${i}`,
		className: "ddz-played-card ddz-card-stack-item",
		style: { "--ddz-delay": `${i * 35}ms` }
	}, (0, react.createElement)(CardView, { card })))) : null, isSpecialPlay && play && (0, react.createElement)("span", {
		className: "ddz-special-label ddz-special-label-" + play.kind,
		key: `special-${cardKey}`
	}, KIND_NAMES[play.kind]));
}
function seatLabel(seat, humanSeat) {
	if (seat === humanSeat) return "你";
	return seat === (humanSeat + 1) % 3 ? "下家" : "上家";
}
function GameTableShell(props) {
	const { view, selected, notice, remainingSeconds, onToggleCard, onPlay, onPass, onHint, onCall, onDouble, onMing, callAnnouncement, onExit, onDismissNotice } = props;
	const [playedBySeat, setPlayedBySeat] = (0, react.useState)(() => [
		null,
		null,
		null
	]);
	const [arranging, setArranging] = (0, react.useState)(false);
	const prevPhaseRef = (0, react.useRef)(null);
	(0, react.useEffect)(() => {
		const prev = prevPhaseRef.current;
		prevPhaseRef.current = view.phase;
		if (prev === "dealing" && view.phase !== "dealing" && view.phase !== "settled") {
			setArranging(true);
			const t = window.setTimeout(() => setArranging(false), 700);
			return () => window.clearTimeout(t);
		}
	}, [view.phase]);
	const [actionText, setActionText] = (0, react.useState)({});
	const actionKeyRef = (0, react.useRef)({});
	const lastShownRef = (0, react.useRef)({});
	const prevSnapshotRef = (0, react.useRef)(null);
	const callingClearedRef = (0, react.useRef)(false);
	const showAction = (0, react.useCallback)((seat, text) => {
		const now = Date.now();
		const last = lastShownRef.current[seat];
		if (last && last.text === text && now - last.at < 800) return;
		lastShownRef.current[seat] = {
			text,
			at: now
		};
		actionKeyRef.current[seat] = now + Math.random();
		setActionText((prev) => prev[seat] === text ? prev : {
			...prev,
			[seat]: text
		});
	}, []);
	const clearSeatCards = (0, react.useCallback)((seat) => {
		setPlayedBySeat((prev) => {
			if (prev[seat] === null) return prev;
			const next = [...prev];
			next[seat] = null;
			return next;
		});
	}, []);
	(0, react.useEffect)(() => {
		const prev = prevSnapshotRef.current;
		if (prev) {
			const fx = inferAction(prev, view);
			if (fx) {
				showAction(fx.seat, fx.text);
				if (fx.text === "过") clearSeatCards(fx.seat);
			}
		}
		prevSnapshotRef.current = snapshotOf(view);
	}, [
		view,
		showAction,
		clearSeatCards
	]);
	(0, react.useEffect)(() => {
		if (view.phase !== "playing" || !callingClearedRef.current) return;
		const seat = view.current;
		setActionText((prev) => prev[seat] == null ? prev : {
			...prev,
			[seat]: null
		});
	}, [view.phase, view.current]);
	(0, react.useEffect)(() => {
		if (view.phase === "playing") {
			if (!callingClearedRef.current && view.lastPlayCards !== null && view.lastPlayCards.length > 0) {
				callingClearedRef.current = true;
				setActionText({});
			}
		} else callingClearedRef.current = false;
	}, [view.phase, view.lastPlayCards]);
	(0, react.useEffect)(() => {
		if (view.phase === "dealing" || view.phase === "calling" && view.callActor === 0) setActionText({});
	}, [view.phase, view.callActor]);
	const dragRef = (0, react.useRef)(false);
	const suppressClickRef = (0, react.useRef)(false);
	(0, react.useEffect)(() => {
		const endDrag = () => {
			window.setTimeout(() => {
				dragRef.current = false;
				suppressClickRef.current = false;
			}, 0);
		};
		window.addEventListener("pointerup", endDrag);
		window.addEventListener("pointercancel", endDrag);
		window.addEventListener("blur", endDrag);
		return () => {
			window.removeEventListener("pointerup", endDrag);
			window.removeEventListener("pointercancel", endDrag);
			window.removeEventListener("blur", endDrag);
		};
	}, []);
	(0, react.useEffect)(() => {
		setPlayedBySeat((prev) => {
			const next = [...prev];
			let changed = false;
			if (view.phase === "playing" && view.current === view.mySeat && next[view.mySeat] !== null) {
				next[view.mySeat] = null;
				changed = true;
			}
			if (view.lastPlayCards !== null && view.lastPlayCards.length > 0 && view.lastActor !== null) {
				const actor = view.lastActor;
				const cards = view.lastPlayCards;
				if (next[actor] !== cards) {
					next[actor] = cards;
					changed = true;
				}
			}
			return changed ? next : prev;
		});
	}, [
		view.phase,
		view.current,
		view.mySeat,
		view.lastActor,
		view.lastPlayCards
	]);
	const dismissNoticeRef = (0, react.useRef)(onDismissNotice);
	dismissNoticeRef.current = onDismissNotice;
	(0, react.useEffect)(() => {
		if (!notice) return;
		const t = window.setTimeout(() => dismissNoticeRef.current(), 2600);
		return () => window.clearTimeout(t);
	}, [notice]);
	const sortedHand = (0, react.useMemo)(() => sortHand(view.myHand), [view.myHand]);
	const humanView = view.seats.find((s) => s.isHuman) ?? view.seats[view.mySeat];
	const otherSeats = view.seats.filter((s) => !s.isHuman);
	const nextSeat = (view.mySeat + 1) % 3;
	const prevSeat = (view.mySeat + 2) % 3;
	const botA = otherSeats.find((s) => s.seat === prevSeat) ?? otherSeats[0];
	const botB = otherSeats.find((s) => s.seat === nextSeat) ?? otherSeats[1];
	const isTurnPhase = view.phase === "calling" || view.phase === "robbing" || view.phase === "doubling" || view.phase === "playing";
	const isMyTurn = !view.finished && isTurnPhase && view.current === view.mySeat;
	const lastPlay = view.lastPlayCards && view.lastPlayCards.length > 0 ? classify(view.lastPlayCards) : null;
	const canPass = view.phase === "playing" && lastPlay !== null;
	const canPlaySelected = () => {
		if (view.phase !== "playing" || !isMyTurn || selected.length === 0) return false;
		const play = classify(selected);
		if (!play) return false;
		if (!canBeat(play, lastPlay)) return false;
		return selected.every((c) => view.myHand.some((x) => x.r === c.r && x.s === c.s));
	};
	const showCountdown = remainingSeconds !== null && remainingSeconds > 0;
	const revealedFor = (seatView) => {
		if (!seatView) return void 0;
		return view.revealed[seatView.seat] ? seatView.hand ?? [] : void 0;
	};
	const actionFor = (seat) => {
		const text = actionText[seat];
		return text ? {
			text,
			id: actionKeyRef.current[seat] ?? 0
		} : null;
	};
	return (0, react.createElement)("div", { className: "ddz-body ddz-table-screen" }, (0, react.createElement)("button", {
		className: "ddz-table-exit",
		onClick: onExit
	}, "← 退出牌桌"), (0, react.createElement)("div", {
		className: "ddz-table-reserved-bar",
		"aria-hidden": true
	}), notice && view.phase !== "playing" && (0, react.createElement)("div", {
		className: "ddz-toast",
		onClick: onDismissNotice
	}, notice), (0, react.createElement)("div", { className: "ddz-table ddz-game-table" }, (0, react.createElement)("div", { className: "ddz-top-reveal" }, view.bottom.length > 0 ? (0, react.createElement)("div", {
		key: "revealed",
		className: "ddz-reveal-cards is-revealed",
		"aria-label": "已揭示的地主底牌",
		"aria-live": "polite"
	}, ...view.bottom.map((card, i) => (0, react.createElement)("div", {
		key: i,
		className: "ddz-reveal-card",
		style: { "--ddz-delay": `${i * 45}ms` }
	}, (0, react.createElement)(CardView, { card })))) : (0, react.createElement)("div", {
		key: "hidden",
		className: "ddz-reveal-cards ddz-reveal-back-set",
		"aria-label": "地主底牌待揭示"
	}, ...[
		0,
		1,
		2
	].map((i) => (0, react.createElement)("div", {
		key: i,
		className: "ddz-reveal-card",
		style: { "--ddz-delay": `${i * 45}ms` }
	}, (0, react.createElement)(CardBack))))), (0, react.createElement)("div", { className: "ddz-table-middle" }, (0, react.createElement)("div", { className: "ddz-side-zone left" }, botA && (0, react.createElement)(SeatPanel, {
		view,
		seatView: botA,
		isTurn: isTurnPhase && view.current === botA.seat,
		revealedCards: revealedFor(botA)
	}), botA && (0, react.createElement)(PlayedArea, {
		seat: botA.seat,
		humanSeat: view.mySeat,
		cards: playedBySeat[botA.seat],
		countdownSeconds: isTurnPhase && view.current === botA.seat && showCountdown ? remainingSeconds : null,
		action: actionFor(botA.seat)
	})), (0, react.createElement)("div", {
		className: "ddz-table-center",
		style: { textAlign: "center" }
	}, (0, react.createElement)("div", { className: "ddz-table-turn-label" }, view.phase === "dealing" ? view.dealRound === 0 ? "洗牌中…" : `发牌中… 第 ${view.dealRound}/3 轮` : view.phase === "calling" ? callAnnouncement ?? (isMyTurn ? "轮到你叫地主" : "等待叫地主…") : view.phase === "robbing" ? callAnnouncement ?? (isMyTurn ? "轮到你抢地主" : "等待抢地主…") : view.phase === "doubling" ? isMyTurn ? "轮到你加倍" : "等待加倍…" : view.phase === "playing" ? callAnnouncement ?? (isMyTurn ? "轮到你出牌" : "对手出牌中…") : ""), (0, react.createElement)("div", {
		className: "ddz-multiplier",
		style: {
			marginTop: 6,
			display: "inline-block"
		},
		"aria-live": "polite"
	}, `总倍率 ×${view.multiplier}`)), (0, react.createElement)("div", { className: "ddz-side-zone right" }, botB && (0, react.createElement)(PlayedArea, {
		seat: botB.seat,
		humanSeat: view.mySeat,
		cards: playedBySeat[botB.seat],
		countdownSeconds: isTurnPhase && view.current === botB.seat && showCountdown ? remainingSeconds : null,
		action: actionFor(botB.seat)
	}), botB && (0, react.createElement)(SeatPanel, {
		view,
		seatView: botB,
		isTurn: isTurnPhase && view.current === botB.seat,
		revealedCards: revealedFor(botB)
	}))), (0, react.createElement)("div", {
		className: "ddz-human-area",
		style: { textAlign: "center" }
	}, (0, react.createElement)(PlayedArea, {
		seat: view.mySeat,
		humanSeat: view.mySeat,
		cards: playedBySeat[view.mySeat],
		action: actionFor(view.mySeat)
	}), (0, react.createElement)("div", { className: "ddz-human-hand-row" }, humanView && (0, react.createElement)(SeatPanel, {
		view,
		seatView: humanView,
		isTurn: isMyTurn,
		revealedCards: revealedFor(humanView)
	}), (0, react.createElement)("div", {
		className: "ddz-row ddz-hand ddz-folded-cards ddz-human-hand" + (arranging ? " ddz-hand-arranging" : ""),
		style: {
			flexWrap: "nowrap",
			gap: 0,
			paddingBottom: 4
		}
	}, ...sortedHand.map((c, i) => (0, react.createElement)("div", {
		key: `${c.r}-${c.s}`,
		className: "ddz-hand-card ddz-card-stack-item",
		style: { "--ddz-delay": `${Math.min(i, 12) * 35}ms` },
		onPointerDown: (event) => {
			if (event.button !== 0) return;
			dragRef.current = true;
			suppressClickRef.current = true;
			onToggleCard(c);
		},
		onPointerEnter: () => {
			if (dragRef.current) onToggleCard(c);
		}
	}, (0, react.createElement)(CardView, {
		card: c,
		size: "big",
		selected: selected.some((x) => x.r === c.r && x.s === c.s),
		onClick: () => {
			if (suppressClickRef.current) {
				suppressClickRef.current = false;
				return;
			}
			onToggleCard(c);
		}
	}))))), (0, react.createElement)("div", {
		className: "ddz-action-dock ddz-row" + (isMyTurn ? " is-active" : ""),
		style: {
			justifyContent: "center",
			gap: 10,
			marginTop: 10
		}
	}, view.phase === "dealing" ? view.revealed[view.mySeat] ? (0, react.createElement)("span", { className: "ddz-action-status ddz-dim" }, "已明牌") : view.dealRound >= 1 ? (0, react.createElement)("div", {
		className: "ddz-row",
		style: { gap: 10 }
	}, (0, react.createElement)("span", { className: "ddz-action-status ddz-dim" }, `发牌中 第 ${view.dealRound}/3 轮`), (0, react.createElement)("button", {
		className: "ddz-btn ddz-btn-red",
		onClick: () => {
			onMing();
			showAction(view.mySeat, "明牌");
		}
	}, `明牌 ×${5 - view.dealRound}`)) : (0, react.createElement)("span", { className: "ddz-action-status ddz-dim" }, "洗牌中…") : view.phase === "calling" ? isMyTurn ? (0, react.createElement)("div", {
		className: "ddz-row",
		style: { gap: 10 }
	}, (0, react.createElement)("button", {
		className: "ddz-btn",
		onClick: () => {
			onCall(true);
			showAction(view.mySeat, "叫地主");
		}
	}, "叫地主"), (0, react.createElement)("button", {
		className: "ddz-btn ddz-btn-ghost",
		onClick: () => {
			onCall(false);
			showAction(view.mySeat, "不叫");
		}
	}, "不叫")) : (0, react.createElement)("span", { className: "ddz-action-status ddz-dim" }, "等待叫地主…") : view.phase === "robbing" ? isMyTurn ? (0, react.createElement)("div", {
		className: "ddz-row",
		style: { gap: 10 }
	}, (0, react.createElement)("button", {
		className: "ddz-btn",
		onClick: () => {
			onCall(true);
			showAction(view.mySeat, "抢地主");
		}
	}, "抢地主"), (0, react.createElement)("button", {
		className: "ddz-btn ddz-btn-ghost",
		onClick: () => {
			onCall(false);
			showAction(view.mySeat, "不抢");
		}
	}, "不抢")) : (0, react.createElement)("span", { className: "ddz-action-status ddz-dim" }, "等待抢地主…") : view.phase === "doubling" ? isMyTurn ? (0, react.createElement)("div", {
		className: "ddz-row",
		style: { gap: 10 }
	}, (0, react.createElement)("button", {
		className: "ddz-btn ddz-btn-ghost",
		onClick: () => {
			onDouble(0);
			showAction(view.mySeat, "不加倍");
		}
	}, "不加倍"), (0, react.createElement)("button", {
		className: "ddz-btn",
		onClick: () => {
			onDouble(1);
			showAction(view.mySeat, "加倍");
		}
	}, "加倍 ×2"), (0, react.createElement)("button", {
		className: "ddz-btn ddz-btn-gold",
		onClick: () => {
			onDouble(2);
			showAction(view.mySeat, "超级加倍");
		}
	}, "超级加倍 ×4"), showCountdown && (0, react.createElement)("span", {
		className: "ddz-countdown ddz-action-countdown" + ((remainingSeconds ?? 0) <= 3 ? " urgent" : ""),
		"aria-live": "polite"
	}, `${remainingSeconds}s`)) : (0, react.createElement)("span", { className: "ddz-action-status ddz-dim" }, "等待加倍…") : view.phase === "playing" ? isMyTurn ? (0, react.createElement)("div", {
		className: "ddz-row",
		style: { gap: 10 }
	}, view.landlord === view.mySeat && !view.revealed[view.mySeat] && view.landlordPlays === 0 && (0, react.createElement)("button", {
		className: "ddz-btn ddz-btn-red",
		onClick: () => {
			onMing();
			showAction(view.mySeat, "明牌");
		}
	}, "明牌"), (0, react.createElement)("button", {
		className: "ddz-btn",
		disabled: !canPlaySelected(),
		onClick: onPlay
	}, "出牌"), (0, react.createElement)("div", { className: "ddz-action-hint" }, notice && (0, react.createElement)("div", {
		className: "ddz-action-bubble",
		role: "status",
		onClick: onDismissNotice
	}, notice), (0, react.createElement)("button", {
		className: "ddz-btn ddz-btn-ghost",
		onClick: onHint
	}, "提示")), (0, react.createElement)("button", {
		className: "ddz-btn ddz-btn-ghost",
		disabled: !canPass,
		onClick: () => {
			onPass();
			showAction(view.mySeat, "过");
			clearSeatCards(view.mySeat);
		}
	}, "过"), showCountdown && (0, react.createElement)("span", {
		className: "ddz-countdown ddz-action-countdown" + ((remainingSeconds ?? 0) <= 3 ? " urgent" : ""),
		"aria-live": "polite"
	}, `${remainingSeconds}s`)) : (0, react.createElement)("span", { className: "ddz-action-status ddz-turn" }, "对手思考中…") : null))));
}
function SeatPanel(props) {
	const { view, seatView, isTurn, revealedCards } = props;
	const statusLabel = seatView.isHuman ? `倍率 ×${view.multiplier}` : seatView.handCount + " 张手牌";
	const statusClass = seatView.isHuman ? "ddz-multiplier" : "ddz-card-count";
	return (0, react.createElement)("div", { className: "ddz-seat" }, revealedCards && revealedCards.length > 0 && (0, react.createElement)("div", {
		className: "ddz-revealed-row",
		role: "img",
		"aria-label": `${seatView.nickname}明牌`
	}, ...revealedCards.map((c) => (0, react.createElement)("div", {
		key: `${c.r}-${c.s}`,
		className: "ddz-revealed-card"
	}, (0, react.createElement)(CardView, {
		card: c,
		size: "mini"
	})))), (0, react.createElement)("div", { className: "ddz-seat-identity" }, (0, react.createElement)(PlayerRank, { tokenBalance: seatView.tokenBalance }), (0, react.createElement)("div", { className: "ddz-seat-chip" + (isTurn ? " is-turn" : "") }, (0, react.createElement)(Avatar, {
		avatarId: seatView.avatarId,
		size: 32
	}), (0, react.createElement)("div", { className: "ddz-seat-copy" }, (0, react.createElement)("div", {
		className: "ddz-seat-name",
		style: { gap: 6 }
	}, (0, react.createElement)("span", { style: {
		fontSize: 13,
		fontWeight: 600
	} }, seatView.nickname), seatView.role && (0, react.createElement)(RoleBadge, { role: seatView.role })), (0, react.createElement)("div", { className: "ddz-seat-meta" }, `Token ${formatTokenCount(seatView.tokenBalance)}`)))), (0, react.createElement)("div", { className: "ddz-seat-cards" }, (0, react.createElement)("span", { className: statusClass }, statusLabel)));
}
const MAX_NICKNAME_LENGTH = 12;
function limitNickname(value) {
	const nickname = typeof value === "string" ? value.trim() : "";
	return Array.from(nickname).slice(0, MAX_NICKNAME_LENGTH).join("") || "斗地主玩家";
}
function loadProfile() {
	try {
		const raw = localStorage.getItem("ddz:profile");
		if (raw) {
			const profile = JSON.parse(raw);
			return {
				...profile,
				nickname: limitNickname(profile.nickname)
			};
		}
	} catch {}
	const profile = {
		uid: crypto.randomUUID(),
		nickname: limitNickname("斗地主玩家" + Math.floor(1e3 + Math.random() * 9e3)),
		avatarId: Math.random() < .5 ? "default-01" : "default-02"
	};
	localStorage.setItem("ddz:profile", JSON.stringify(profile));
	return profile;
}
function saveProfile(profile) {
	localStorage.setItem("ddz:profile", JSON.stringify(profile));
}
function Lobby(props) {
	const { profile, balance, onClaim, claimed, online, matching, matchCount, rescued, onRescue, syncing, lobbyLatency, onRetryConnect, onStartOnline, onCancelMatch, onProfileChange, onClose } = props;
	const rank = rankForBalance(balance);
	const minBalance = Math.min(...CONFIG.tables.map((t) => t.minBalance));
	const thresholdLabel = (t) => t.maxBalance === void 0 ? `${t.minBalance.toLocaleString()}+` : `${t.minBalance.toLocaleString()}–${t.maxBalance.toLocaleString()}`;
	const lobbyLatencyClass = lobbyLatency === null ? "" : lobbyLatency < 100 ? " good" : lobbyLatency < 250 ? " mid" : " bad";
	const [tableId, setTableId] = (0, react.useState)(CONFIG.tables[0].id);
	const selectedTable = tableById(tableId);
	const entryIssue = !selectedTable ? null : balance < selectedTable.minBalance ? "low" : selectedTable.maxBalance !== void 0 && balance > selectedTable.maxBalance ? "high" : null;
	const [avatarPickerOpen, setAvatarPickerOpen] = (0, react.useState)(false);
	const [editingNickname, setEditingNickname] = (0, react.useState)(false);
	const [nicknameDraft, setNicknameDraft] = (0, react.useState)(profile.nickname);
	const [matchElapsed, setMatchElapsed] = (0, react.useState)(0);
	(0, react.useEffect)(() => {
		if (!matching) return;
		setMatchElapsed(0);
		const timer = window.setInterval(() => setMatchElapsed((s) => s + 1), 1e3);
		return () => window.clearInterval(timer);
	}, [matching]);
	const [rankInfoOpen, setRankInfoOpen] = (0, react.useState)(false);
	(0, react.useEffect)(() => {
		if (!rankInfoOpen) return;
		const onKey = (event) => {
			if (event.key === "Escape") setRankInfoOpen(false);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [rankInfoOpen]);
	const saveNickname = () => {
		const nickname = limitNickname(nicknameDraft);
		onProfileChange({
			...profile,
			nickname
		});
		setNicknameDraft(nickname);
		setEditingNickname(false);
	};
	return (0, react.createElement)(react.Fragment, null, (0, react.createElement)("div", { className: "ddz-body ddz-lobby" }, (0, react.createElement)("div", { className: "ddz-lobby-top" }, (0, react.createElement)("div", { className: "ddz-lobby-profile-stack" }, (0, react.createElement)("div", { className: "ddz-profile ddz-row" }, (0, react.createElement)("div", { className: "ddz-avatar-picker-anchor" }, (0, react.createElement)("button", {
		type: "button",
		className: "ddz-avatar-button",
		"aria-label": "选择默认头像",
		"aria-haspopup": "dialog",
		"aria-expanded": avatarPickerOpen,
		onClick: () => {
			setAvatarPickerOpen((open) => !open);
			setEditingNickname(false);
		}
	}, (0, react.createElement)(Avatar, { avatarId: profile.avatarId })), avatarPickerOpen && (0, react.createElement)("div", {
		className: "ddz-avatar-picker",
		role: "dialog",
		"aria-label": "选择默认头像"
	}, (0, react.createElement)("div", { className: "ddz-avatar-picker-title" }, "选择默认头像"), (0, react.createElement)("div", { className: "ddz-avatar-options" }, ...[{
		id: "default-01",
		label: "蓝色"
	}, {
		id: "default-02",
		label: "黑色"
	}].map((avatar) => (0, react.createElement)("button", {
		key: avatar.id,
		type: "button",
		className: "ddz-avatar-option" + (profile.avatarId === avatar.id ? " selected" : ""),
		"aria-label": `选择${avatar.label}默认头像`,
		"aria-pressed": profile.avatarId === avatar.id,
		onClick: () => {
			onProfileChange({
				...profile,
				avatarId: avatar.id
			});
			setAvatarPickerOpen(false);
		}
	}, (0, react.createElement)(Avatar, {
		avatarId: avatar.id,
		size: 34
	}), (0, react.createElement)("span", null, avatar.label)))))), (0, react.createElement)("div", { className: "ddz-profile-copy" }, editingNickname ? (0, react.createElement)("div", { className: "ddz-nickname-editor" }, (0, react.createElement)("input", {
		className: "ddz-nickname-input",
		value: nicknameDraft,
		maxLength: MAX_NICKNAME_LENGTH,
		autoFocus: true,
		"aria-label": "编辑昵称",
		onChange: (event) => setNicknameDraft(event.target.value),
		onKeyDown: (event) => {
			if (event.key === "Enter") saveNickname();
			if (event.key === "Escape") {
				setNicknameDraft(profile.nickname);
				setEditingNickname(false);
			}
		}
	}), (0, react.createElement)("button", {
		type: "button",
		className: "ddz-icon-btn",
		"aria-label": "保存昵称",
		onClick: saveNickname
	}, (0, react.createElement)(CheckIcon)), (0, react.createElement)("button", {
		type: "button",
		className: "ddz-icon-btn",
		"aria-label": "取消编辑昵称",
		onClick: () => {
			setNicknameDraft(profile.nickname);
			setEditingNickname(false);
		}
	}, (0, react.createElement)(CloseIcon))) : (0, react.createElement)("div", { className: "ddz-profile-name-row" }, (0, react.createElement)("span", { className: "ddz-profile-name" }, profile.nickname), (0, react.createElement)("button", {
		type: "button",
		className: "ddz-icon-btn",
		"aria-label": "编辑昵称",
		onClick: () => {
			setNicknameDraft(profile.nickname);
			setEditingNickname(true);
			setAvatarPickerOpen(false);
		}
	}, (0, react.createElement)(EditIcon))), (0, react.createElement)("div", { className: "ddz-dim ddz-profile-uid" }, "UID " + profile.uid.slice(0, 8))), (0, react.createElement)("button", {
		type: "button",
		className: "ddz-rank",
		"aria-haspopup": "dialog",
		"aria-expanded": rankInfoOpen,
		title: "查看段位说明",
		onClick: () => setRankInfoOpen(true)
	}, rank.name)), (0, react.createElement)("div", { className: "ddz-balance ddz-row" }, (0, react.createElement)("div", { className: "ddz-balance-copy" }, (0, react.createElement)("div", { className: "ddz-balance-label" }, "Token 余额" + (online ? "（在线）" : "")), (0, react.createElement)("div", { className: "ddz-balance-value" }, balance.toLocaleString()), syncing && (0, react.createElement)("div", {
		className: "ddz-dim",
		style: { fontSize: 12 }
	}, "同步中…")), (0, react.createElement)("button", {
		className: "ddz-btn ddz-balance-btn",
		disabled: claimed || !online,
		onClick: onClaim
	}, claimed ? "今日已领" : `签到 +${CONFIG.dailyTokens.toLocaleString()}`)), online && balance < minBalance && (0, react.createElement)("div", {
		className: "ddz-row",
		style: { marginTop: 12 }
	}, rescued ? (0, react.createElement)("span", { className: "ddz-dim ddz-helper" }, "今日救济金已领") : (0, react.createElement)("button", {
		className: "ddz-btn ddz-btn-ghost",
		onClick: onRescue
	}, `领救济金 +${CONFIG.rescueTokens.toLocaleString()}`)), !online && (0, react.createElement)("div", { className: "ddz-lobby-connect" }, syncing ? (0, react.createElement)("span", { className: "ddz-dim" }, "正在连接在线对战…") : (0, react.createElement)(react.Fragment, null, (0, react.createElement)("span", { className: "ddz-dim" }, "在线连接失败，无法对战"), (0, react.createElement)("button", {
		className: "ddz-btn ddz-btn-ghost",
		style: {
			marginLeft: 8,
			padding: "6px 12px"
		},
		onClick: onRetryConnect
	}, "重试"))), online && (0, react.createElement)("div", {
		className: "ddz-lobby-latency" + lobbyLatencyClass,
		role: "status",
		title: "到在线服务器的网络延迟"
	}, (0, react.createElement)("span", { className: "ddz-latency-dot" }), (0, react.createElement)("span", null, "网络延迟 "), lobbyLatency === null ? (0, react.createElement)("span", null, "—") : (0, react.createElement)("b", null, `${lobbyLatency}ms`)))), (0, react.createElement)("div", { className: "ddz-lobby-intro" }, (0, react.createElement)("div", { className: "ddz-section-title" }, "选择桌别"), (0, react.createElement)("div", { className: "ddz-dim ddz-lobby-subtitle" }, "在线匹配 3 名真人玩家；15 秒凑不齐则补入机器人对局")), (0, react.createElement)("div", { className: "ddz-table-grid" }, ...CONFIG.tables.map((t) => (0, react.createElement)("button", {
		key: t.id,
		type: "button",
		className: "ddz-tab" + (tableId === t.id ? " on" : ""),
		"aria-pressed": tableId === t.id,
		onClick: () => setTableId(t.id)
	}, (0, react.createElement)("div", { style: { fontWeight: 700 } }, t.label), (0, react.createElement)("div", {
		className: "ddz-dim",
		style: { fontSize: 12 }
	}, `底分 ${t.base.toLocaleString()} · 余额门槛 ${thresholdLabel(t)}`)))), (0, react.createElement)("div", { className: "ddz-lobby-actions" }, matching ? (0, react.createElement)("button", {
		className: "ddz-btn ddz-btn-red",
		onClick: onCancelMatch
	}, `匹配中… ${matchElapsed}s · ${matchCount}/3（点击取消）`) : (0, react.createElement)("button", {
		className: "ddz-btn",
		disabled: !online || entryIssue !== null,
		onClick: () => onStartOnline(tableId)
	}, "开始匹配"), (0, react.createElement)("button", {
		className: "ddz-btn ddz-btn-ghost",
		onClick: onClose
	}, "最小化")), entryIssue === "low" && (0, react.createElement)("div", { className: "ddz-dim ddz-helper" }, "余额不足该桌门槛，先签到或领救济金"), entryIssue === "high" && (0, react.createElement)("div", { className: "ddz-dim ddz-helper" }, "余额超过该桌上限，请选择更高档桌")), (0, react.createElement)("div", { className: "ddz-lobby-version" }, `斗地主 v${APP_VERSION}`), (0, react.createElement)("div", { className: "ddz-disclaimer" }, "Token 为虚拟货币，仅作娱乐用途，不可兑换任何真实货币或服务（性质类似欢乐豆）"), rankInfoOpen && (0, react.createElement)("div", {
		className: "ddz-dialog",
		onClick: () => setRankInfoOpen(false)
	}, (0, react.createElement)("div", {
		className: "ddz-dialog-card",
		role: "dialog",
		"aria-modal": "true",
		"aria-label": "段位体系说明",
		onClick: (event) => event.stopPropagation()
	}, (0, react.createElement)("h3", { className: "ddz-dialog-title" }, "段位体系"), (0, react.createElement)("div", { className: "ddz-dialog-body" }, "段位按 Token 当前余额实时划分：余额达标即升段，输钱掉余额即降段。段位仅作荣耀展示，不参与匹配。"), (0, react.createElement)("div", {
		className: "ddz-rank-table",
		role: "list"
	}, ...CONFIG.ranks.map((r, i) => {
		const next = CONFIG.ranks[i + 1];
		const range = next ? `${r.min.toLocaleString()} – ${(next.min - 1).toLocaleString()}` : `${r.min.toLocaleString()}+`;
		const isCurrent = r.id === rank.id;
		return (0, react.createElement)("div", {
			key: r.id,
			role: "listitem",
			className: "ddz-rank-row" + (isCurrent ? " is-current" : "")
		}, (0, react.createElement)("div", { className: "ddz-rank-row-top" }, (0, react.createElement)("span", { className: "ddz-rank-row-name" }, r.name, isCurrent && (0, react.createElement)("span", { className: "ddz-rank-row-current" }, "当前段位")), (0, react.createElement)("span", { className: "ddz-rank-row-range" }, range)));
	})), (0, react.createElement)("div", {
		className: "ddz-row",
		style: {
			justifyContent: "flex-end",
			gap: 10,
			marginTop: 16
		}
	}, (0, react.createElement)("button", {
		className: "ddz-btn",
		onClick: () => setRankInfoOpen(false)
	}, "知道了")))));
}
function OnlineTable(props) {
	const { roomId, tableId, profile, onExit, onSettled } = props;
	const [view, setView] = (0, react.useState)(null);
	const [selected, setSelected] = (0, react.useState)([]);
	const [notice, setNotice] = (0, react.useState)(null);
	const [clock, setClock] = (0, react.useState)(() => Date.now());
	const [latencyMs, setLatencyMs] = (0, react.useState)(null);
	const wsRef = (0, react.useRef)(null);
	const reconnectRef = (0, react.useRef)(0);
	const pingRef = (0, react.useRef)(null);
	const onSettledRef = (0, react.useRef)(onSettled);
	onSettledRef.current = onSettled;
	const settledRef = (0, react.useRef)(false);
	const send = (0, react.useCallback)((msg) => {
		const ws = wsRef.current;
		if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
	}, []);
	(0, react.useEffect)(() => {
		let disposed = false;
		let ws = null;
		const open = () => {
			if (disposed) return;
			ws = connectRoom(roomId);
			wsRef.current = ws;
			ws.addEventListener("message", (ev) => {
				if (disposed) return;
				const msg = JSON.parse(String(ev.data));
				if (msg.t === "state") {
					setView(tableViewFromProtocol(msg.d));
					setClock(Date.now());
				} else if (msg.t === "settle") {
					const d = msg.d;
					window.setTimeout(() => {
						if (disposed) return;
						settledRef.current = true;
						onSettledRef.current(d.myDelta, d.balance_after, d.winner, d.spring, d.multiplier, d.rake);
					}, 1e3);
				} else if (msg.t === "pong") {
					const ts = msg.d.ts;
					if (ts !== void 0 && pingRef.current !== null) setLatencyMs(Math.max(0, Date.now() - ts));
					pingRef.current = null;
				} else if (msg.t === "error") setNotice(msg.d.message);
			});
			ws.addEventListener("close", () => {
				if (disposed || settledRef.current) return;
				if (reconnectRef.current < 3) {
					reconnectRef.current += 1;
					setNotice(`连接断开，正在重连（${reconnectRef.current}/3）…`);
					window.setTimeout(open, 1500);
				} else setNotice("连接已断开");
			});
		};
		open();
		return () => {
			disposed = true;
			ws?.close();
		};
	}, [roomId]);
	(0, react.useEffect)(() => {
		const timer = window.setInterval(() => setClock(Date.now()), 250);
		return () => window.clearInterval(timer);
	}, []);
	(0, react.useEffect)(() => {
		const timer = window.setInterval(() => {
			const ws = wsRef.current;
			if (!ws || ws.readyState !== WebSocket.OPEN) {
				setLatencyMs(null);
				return;
			}
			const ts = Date.now();
			pingRef.current = ts;
			send({
				v: 2,
				t: "ping",
				d: { ts }
			});
		}, 3e3);
		return () => window.clearInterval(timer);
	}, [send]);
	const remainingSeconds = view && !view.finished ? Math.max(0, Math.ceil((view.turnStartedAt + view.turnTimeoutMs - clock) / 1e3)) : null;
	const toggleSelect = (card) => {
		if (!view || view.finished) return;
		setSelected((prev) => {
			const idx = prev.findIndex((x) => x.r === card.r && x.s === card.s);
			if (idx >= 0) return prev.filter((_, i) => i !== idx);
			return [...prev, card];
		});
	};
	const doHint = () => {
		if (!view || view.finished || view.current !== view.mySeat) return;
		const last = view.lastPlayCards && view.lastPlayCards.length > 0 ? classify(view.lastPlayCards) : null;
		const h = hintPlay(view.myHand, last);
		if (!h) {
			setNotice("没有能压过的牌，过吧");
			return;
		}
		setNotice(null);
		setSelected(h);
	};
	const latencyFooter = (0, react.createElement)("div", {
		className: "ddz-latency" + (latencyMs === null ? "" : latencyMs < 100 ? " good" : latencyMs < 250 ? " mid" : " bad"),
		role: "status",
		"aria-live": "polite"
	}, (0, react.createElement)("span", { className: "ddz-latency-dot" }), latencyMs === null ? (0, react.createElement)("span", null, "网络延迟 —") : (0, react.createElement)("span", null, "网络延迟 ", (0, react.createElement)("b", null, `${latencyMs}ms`)), (0, react.createElement)("span", { className: "ddz-latency-sep" }, "·"), (0, react.createElement)("span", null, "版本 ", (0, react.createElement)("b", null, `v${APP_VERSION}`)));
	if (!view) return (0, react.createElement)(react.Fragment, null, (0, react.createElement)("div", { className: "ddz-body ddz-table-screen" }, (0, react.createElement)("div", {
		className: "ddz-table ddz-game-table",
		style: {
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			color: "var(--dz-dim)"
		}
	}, "对局连接中…")), latencyFooter);
	return (0, react.createElement)(react.Fragment, null, (0, react.createElement)(GameTableShell, {
		view,
		selected,
		notice,
		remainingSeconds,
		onToggleCard: toggleSelect,
		onPlay: () => {
			send({
				v: 2,
				t: "play",
				d: { cards: selected }
			});
			setSelected([]);
		},
		onPass: () => send({
			v: 2,
			t: "pass",
			d: {}
		}),
		onHint: doHint,
		onCall: (call) => send({
			v: 2,
			t: "call",
			d: { call }
		}),
		onDouble: (choice) => send({
			v: 2,
			t: "double",
			d: { choice }
		}),
		onMing: () => send({
			v: 2,
			t: "ming",
			d: {}
		}),
		callAnnouncement: null,
		onExit,
		onDismissNotice: () => setNotice(null)
	}), latencyFooter);
}
/** 对局结算：以弹窗形式盖在牌桌之上（打完最后一手约 1s 后弹出） */
function SettleDialog(props) {
	const { result, balance, onExit } = props;
	const myDelta = result.myDelta;
	const win = myDelta > 0;
	return (0, react.createElement)("div", {
		className: "ddz-dialog",
		onClick: onExit
	}, (0, react.createElement)("div", {
		className: "ddz-dialog-card",
		role: "dialog",
		"aria-modal": "true",
		"aria-label": "对局结算",
		onClick: (event) => event.stopPropagation(),
		style: {
			textAlign: "center",
			padding: 26
		}
	}, (0, react.createElement)("div", {
		className: "ddz-big",
		style: { color: win ? "var(--dz-gold)" : myDelta === 0 ? "var(--dz-dim)" : "var(--dz-red)" }
	}, win ? "🎉 你赢了" : myDelta === 0 ? "平局" : "这局输了"), (0, react.createElement)("div", {
		className: "ddz-dim",
		style: { margin: "10px 0" }
	}, `${result.winner} · ${result.spring === "none" ? "无春天" : result.spring} · 总倍数 ×${result.multiplier} · 抽水 ${result.rake.toLocaleString()}`), (0, react.createElement)("div", { className: "ddz-result-amount" }, `${myDelta > 0 ? "+" : ""}${myDelta.toLocaleString()}`), (0, react.createElement)("div", { className: "ddz-dim" }, `当前余额 ${balance.toLocaleString()}`), (0, react.createElement)("div", {
		className: "ddz-row",
		style: {
			justifyContent: "center",
			gap: 10,
			marginTop: 18
		}
	}, (0, react.createElement)("button", {
		className: "ddz-btn",
		onClick: onExit
	}, "返回大厅"))));
}
const PIP_MIN_WIDTH = 360;
const PIP_MIN_HEIGHT = 280;
const PIP_MAX_WIDTH = 680;
const PIP_MAX_HEIGHT = 600;
/** 小窗长宽比约束（宽/高）：不能过窄过高，也不能过宽过扁（高 ≤ 1.43×宽，宽 ≤ 1.8×高） */
const PIP_MIN_ASPECT = .7;
const PIP_MAX_ASPECT = 1.8;
function getPipLimits() {
	const maxWidth = Math.max(1, window.innerWidth - 24);
	const maxHeight = Math.max(1, window.innerHeight - 24);
	return {
		minWidth: Math.min(PIP_MIN_WIDTH, maxWidth),
		minHeight: Math.min(PIP_MIN_HEIGHT, maxHeight),
		maxWidth,
		maxHeight
	};
}
function clampPipBounds(bounds, anchor) {
	const limits = getPipLimits();
	const right = bounds.left + bounds.width;
	const bottom = bounds.top + bounds.height;
	let width = Math.min(Math.max(bounds.width, limits.minWidth), limits.maxWidth);
	let height = Math.min(Math.max(bounds.height, limits.minHeight), limits.maxHeight);
	if (width / height > PIP_MAX_ASPECT) width = Math.max(limits.minWidth, height * PIP_MAX_ASPECT);
	else if (width / height < PIP_MIN_ASPECT) height = Math.max(limits.minHeight, width / PIP_MIN_ASPECT);
	width = Math.min(Math.max(width, limits.minWidth), limits.maxWidth);
	height = Math.min(Math.max(height, limits.minHeight), limits.maxHeight);
	const left = anchor?.right ? right - width : bounds.left;
	const top = anchor?.bottom ? bottom - height : bounds.top;
	return {
		width,
		height,
		left: Math.min(Math.max(left, 0), Math.max(0, window.innerWidth - width)),
		top: Math.min(Math.max(top, 0), Math.max(0, window.innerHeight - height))
	};
}
function getInitialPipBounds() {
	const limits = getPipLimits();
	const width = Math.min(PIP_MAX_WIDTH, limits.maxWidth);
	const height = Math.min(PIP_MAX_HEIGHT, limits.maxHeight);
	return clampPipBounds({
		width,
		height,
		left: window.innerWidth - 18 - width,
		top: window.innerHeight - 18 - height
	});
}
function resizePipBounds(start, direction, deltaX, deltaY) {
	const limits = getPipLimits();
	const right = start.left + start.width;
	const bottom = start.top + start.height;
	let left = start.left;
	let top = start.top;
	let width = start.width;
	let height = start.height;
	if (direction.includes("e")) {
		const maxWidth = Math.min(limits.maxWidth, window.innerWidth - start.left);
		width = Math.min(Math.max(start.width + deltaX, limits.minWidth), Math.max(limits.minWidth, maxWidth));
	} else if (direction.includes("w")) {
		const maxWidth = Math.min(limits.maxWidth, right);
		width = Math.min(Math.max(start.width - deltaX, limits.minWidth), Math.max(limits.minWidth, maxWidth));
		left = right - width;
	}
	if (direction.includes("s")) {
		const maxHeight = Math.min(limits.maxHeight, window.innerHeight - start.top);
		height = Math.min(Math.max(start.height + deltaY, limits.minHeight), Math.max(limits.minHeight, maxHeight));
	} else if (direction.includes("n")) {
		const maxHeight = Math.min(limits.maxHeight, bottom);
		height = Math.min(Math.max(start.height - deltaY, limits.minHeight), Math.max(limits.minHeight, maxHeight));
		top = bottom - height;
	}
	return clampPipBounds({
		left,
		top,
		width,
		height
	}, {
		right: direction.includes("w"),
		bottom: direction.includes("n")
	});
}
function findHostNewSessionButton() {
	const candidates = document.querySelectorAll("button,[role=\"button\"]");
	return Array.from(candidates).find((element) => {
		const text = (element.textContent ?? "").replace(/\s+/g, "");
		const aria = `${element.getAttribute("aria-label") ?? ""}${element.getAttribute("title") ?? ""}`.replace(/\s+/g, "");
		const className = String(element.className);
		return text === "新会话" || aria.includes("新建会话") && (text.includes("新会话") || className.includes("newSession"));
	}) ?? null;
}
function findHostWorkspaceSection() {
	const label = Array.from(document.querySelectorAll("*")).filter((element) => {
		const rect = element.getBoundingClientRect();
		return element.textContent?.trim() === "工作区" && rect.width > 0 && rect.height > 0;
	}).sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0];
	const header = label?.tagName === "SPAN" ? label.parentElement : label;
	const section = header?.parentElement;
	return header && section ? {
		header,
		section
	} : null;
}
function findHostSidebarToggle() {
	const candidates = document.querySelectorAll("button,[role=\"button\"]");
	return Array.from(candidates).find((element) => {
		return `${element.getAttribute("aria-label") ?? ""}${element.getAttribute("title") ?? ""}`.replace(/\s+/g, "").includes("侧边栏");
	}) ?? null;
}
function findHostSidebarRight() {
	const rootRect = (findHostNewSessionButton()?.closest("[class*=\"_root\"]"))?.getBoundingClientRect();
	return rootRect && rootRect.width > 0 ? Math.round(rootRect.right) : 280;
}
function findHostSidebarRoot() {
	return findHostNewSessionButton()?.closest("[class*=\"_root\"]") ?? null;
}
function SidebarEntry(props) {
	const { onOpen, active } = props;
	const [position, setPosition] = (0, react.useState)(null);
	(0, react.useEffect)(() => {
		let observedTarget = null;
		let resizeObserver = null;
		let observedSection = null;
		let sectionResizeObserver = null;
		let sectionReservation = null;
		const clearSectionReservation = () => {
			if (sectionReservation?.element.isConnected) sectionReservation.element.style.marginTop = sectionReservation.originalMarginTop;
			sectionReservation = null;
		};
		const updatePosition = () => {
			const target = findHostNewSessionButton();
			if (target !== observedTarget) {
				resizeObserver?.disconnect();
				resizeObserver = null;
				observedTarget = target;
				if (target && typeof ResizeObserver !== "undefined") {
					resizeObserver = new ResizeObserver(updatePosition);
					resizeObserver.observe(target);
				}
			}
			if (!target) {
				clearSectionReservation();
				setPosition(null);
				return;
			}
			const rect = target.getBoundingClientRect();
			const height = Math.max(40, Math.round(rect.height || 48));
			const workspace = findHostWorkspaceSection();
			if (workspace?.section !== observedSection) {
				sectionResizeObserver?.disconnect();
				sectionResizeObserver = null;
				observedSection = workspace?.section ?? null;
				if (observedSection && typeof ResizeObserver !== "undefined") {
					sectionResizeObserver = new ResizeObserver(updatePosition);
					sectionResizeObserver.observe(observedSection);
				}
			}
			if (workspace && workspace.section !== sectionReservation?.element) {
				clearSectionReservation();
				sectionReservation = {
					element: workspace.section,
					originalMarginTop: workspace.section.style.marginTop,
					reserve: 0
				};
			}
			if (workspace && sectionReservation) {
				const requiredTop = rect.bottom + 8 + height + 8;
				const baseTop = workspace.header.getBoundingClientRect().top - sectionReservation.reserve;
				const reserve = Math.max(0, Math.ceil(requiredTop - baseTop));
				if (sectionReservation.reserve !== reserve) {
					workspace.section.style.marginTop = reserve > 0 ? `${reserve}px` : sectionReservation.originalMarginTop;
					sectionReservation.reserve = reserve;
				}
			} else clearSectionReservation();
			const toggleRect = findHostSidebarToggle()?.getBoundingClientRect();
			const top = Boolean(workspace) ? rect.bottom + 8 : Math.max(rect.bottom + 8, (toggleRect?.bottom ?? 0) + 8);
			const nextPosition = {
				left: Math.round(rect.left),
				top: Math.max(8, Math.round(top)),
				width: Math.max(36, Math.round(rect.width)),
				height
			};
			setPosition((previous) => previous && previous.left === nextPosition.left && previous.top === nextPosition.top && previous.width === nextPosition.width && previous.height === nextPosition.height ? previous : nextPosition);
		};
		const mutationObserver = new MutationObserver(updatePosition);
		mutationObserver.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: [
				"class",
				"style",
				"aria-label"
			]
		});
		window.addEventListener("resize", updatePosition);
		document.addEventListener("transitionend", updatePosition, true);
		document.addEventListener("animationend", updatePosition, true);
		updatePosition();
		return () => {
			mutationObserver.disconnect();
			resizeObserver?.disconnect();
			sectionResizeObserver?.disconnect();
			clearSectionReservation();
			window.removeEventListener("resize", updatePosition);
			document.removeEventListener("transitionend", updatePosition, true);
			document.removeEventListener("animationend", updatePosition, true);
		};
	}, []);
	const width = position?.width ?? Math.min(380, Math.max(48, window.innerWidth - 20));
	return (0, react.createElement)("div", {
		className: "ddz-sidebar-entry-host" + (width < 180 ? " is-compact" : "") + (active ? " is-active" : ""),
		style: {
			left: position?.left ?? 10,
			top: position?.top ?? 66,
			width,
			height: position?.height ?? 48
		}
	}, (0, react.createElement)("button", {
		type: "button",
		className: "ddz-sidebar-entry",
		"aria-label": active ? "关闭斗地主" : "打开斗地主",
		"aria-pressed": active,
		onClick: onOpen
	}, (0, react.createElement)("span", {
		className: "ddz-sidebar-entry-icon",
		"aria-hidden": true
	}, "🃏"), (0, react.createElement)("span", { className: "ddz-sidebar-entry-copy" }, (0, react.createElement)("span", { className: "ddz-sidebar-entry-title" }, "斗地主"), (0, react.createElement)("span", { className: "ddz-sidebar-entry-subtitle" }, "打开斗地主工作区"))));
}
function DoudizhuApp() {
	const [open, setOpen] = (0, react.useState)(false);
	const [standaloneOpen, setStandaloneOpen] = (0, react.useState)(false);
	const [hostModal, setHostModal] = (0, react.useState)(false);
	const [sidebarRight, setSidebarRight] = (0, react.useState)(280);
	const [pipBounds, setPipBounds] = (0, react.useState)(() => getInitialPipBounds());
	const [pipScale, setPipScale] = (0, react.useState)(1);
	const pipScaleRef = (0, react.useRef)(null);
	const [profile, setProfile] = (0, react.useState)(() => loadProfile());
	const [balance, setBalance] = (0, react.useState)(0);
	const [claimed, setClaimed] = (0, react.useState)(false);
	const [screen, setScreen] = (0, react.useState)("lobby");
	const [tableId, setTableId] = (0, react.useState)(CONFIG.tables[0].id);
	const [result, setResult] = (0, react.useState)(null);
	const [notice, setNotice] = (0, react.useState)(null);
	const [online, setOnline] = (0, react.useState)(false);
	const [matching, setMatching] = (0, react.useState)(false);
	const [matchCount, setMatchCount] = (0, react.useState)(0);
	const [roomId, setRoomId] = (0, react.useState)(null);
	const [rescued, setRescued] = (0, react.useState)(false);
	const [lobbyLatencyMs, setLobbyLatencyMs] = (0, react.useState)(null);
	const [versionError, setVersionError] = (0, react.useState)(null);
	const [copied, setCopied] = (0, react.useState)(false);
	const pollTimerRef = (0, react.useRef)(null);
	const pipInteractionRef = (0, react.useRef)(null);
	const pipBodyStyleRef = (0, react.useRef)(null);
	const [syncing, setSyncing] = (0, react.useState)(false);
	const syncRef = (0, react.useRef)(null);
	(0, react.useEffect)(() => {
		if (!online || !standaloneOpen && !open || screen !== "lobby") {
			setLobbyLatencyMs(null);
			return;
		}
		let disposed = false;
		const ping = async () => {
			const start = Date.now();
			try {
				const h = await health();
				if (disposed) return;
				if (h.protocol !== 2) {
					setVersionError({
						clientProtocol: 2,
						serverProtocol: h.protocol,
						serverVersion: h.version
					});
					setOnline(false);
					return;
				}
				setLobbyLatencyMs(Date.now() - start);
			} catch {
				if (!disposed) setLobbyLatencyMs(null);
			}
		};
		ping();
		const timer = window.setInterval(ping, 3e3);
		return () => {
			disposed = true;
			window.clearInterval(timer);
		};
	}, [
		online,
		open,
		standaloneOpen,
		screen
	]);
	(0, react.useEffect)(() => {
		const updateSidebarRight = () => setSidebarRight(findHostSidebarRight());
		const observer = new MutationObserver(updateSidebarRight);
		observer.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["class", "style"]
		});
		window.addEventListener("resize", updateSidebarRight);
		updateSidebarRight();
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", updateSidebarRight);
		};
	}, []);
	(0, react.useEffect)(() => {
		const hasHostModal = () => {
			const modals = document.querySelectorAll("[aria-modal=\"true\"]");
			for (const el of modals) {
				if (el.closest("[data-dsh-doudizhu]")) continue;
				return true;
			}
			return false;
		};
		const check = () => setHostModal(hasHostModal());
		check();
		const observer = new MutationObserver(check);
		observer.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["aria-modal", "role"]
		});
		return () => observer.disconnect();
	}, []);
	(0, react.useEffect)(() => {
		const closeOnHostNavigation = (event) => {
			if (!standaloneOpen && !open) return;
			const target = event.target;
			if (!(target instanceof HTMLElement) || target.closest("[data-dsh-doudizhu]")) return;
			const sidebar = findHostSidebarRoot();
			if (!sidebar || !sidebar.contains(target)) return;
			const navigationItem = target.closest("[role=\"treeitem\"]");
			const newSession = findHostNewSessionButton();
			if (!navigationItem && !newSession?.contains(target)) return;
			setStandaloneOpen(false);
		};
		document.addEventListener("click", closeOnHostNavigation, true);
		return () => document.removeEventListener("click", closeOnHostNavigation, true);
	}, [open, standaloneOpen]);
	(0, react.useEffect)(() => {
		if (standaloneOpen) document.body.dataset.dshDoudizhuStandalone = "true";
		else delete document.body.dataset.dshDoudizhuStandalone;
		return () => {
			delete document.body.dataset.dshDoudizhuStandalone;
		};
	}, [standaloneOpen]);
	(0, react.useEffect)(() => {
		if (!open) return;
		const endInteraction = () => {
			pipInteractionRef.current = null;
			if (pipBodyStyleRef.current) {
				document.body.style.cursor = pipBodyStyleRef.current.cursor;
				document.body.style.userSelect = pipBodyStyleRef.current.userSelect;
				pipBodyStyleRef.current = null;
			}
		};
		const onPointerMove = (event) => {
			const interaction = pipInteractionRef.current;
			if (!interaction) return;
			const deltaX = event.clientX - interaction.startX;
			const deltaY = event.clientY - interaction.startY;
			setPipBounds(interaction.kind === "move" ? clampPipBounds({
				...interaction.startBounds,
				left: interaction.startBounds.left + deltaX,
				top: interaction.startBounds.top + deltaY
			}) : resizePipBounds(interaction.startBounds, interaction.direction, deltaX, deltaY));
		};
		const onWindowResize = () => setPipBounds((current) => clampPipBounds(current));
		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", endInteraction);
		window.addEventListener("pointercancel", endInteraction);
		window.addEventListener("resize", onWindowResize);
		return () => {
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", endInteraction);
			window.removeEventListener("pointercancel", endInteraction);
			window.removeEventListener("resize", onWindowResize);
			endInteraction();
		};
	}, [open]);
	(0, react.useEffect)(() => {
		if (!open) {
			setPipScale(1);
			return;
		}
		const el = pipScaleRef.current;
		const canvas = el?.parentElement;
		if (!el || !canvas) return;
		const update = () => {
			const availW = canvas.clientWidth;
			const availH = canvas.clientHeight;
			const naturalW = el.scrollWidth || availW;
			const naturalH = el.scrollHeight || availH;
			setPipScale(Math.min(1, availW / naturalW, availH / naturalH));
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(canvas);
		ro.observe(el);
		return () => ro.disconnect();
	}, [open, screen]);
	const beginPipInteraction = (event, interaction) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		if (!pipBodyStyleRef.current) pipBodyStyleRef.current = {
			cursor: document.body.style.cursor,
			userSelect: document.body.style.userSelect
		};
		pipInteractionRef.current = {
			...interaction,
			startX: event.clientX,
			startY: event.clientY,
			startBounds: pipBounds
		};
		document.body.style.userSelect = "none";
		document.body.style.cursor = interaction.kind === "move" ? "grabbing" : interaction.direction === "n" || interaction.direction === "s" ? "ns-resize" : interaction.direction === "e" || interaction.direction === "w" ? "ew-resize" : interaction.direction === "ne" || interaction.direction === "sw" ? "nesw-resize" : "nwse-resize";
	};
	const startPipMove = (event) => {
		if (event.target.closest("button")) return;
		beginPipInteraction(event, { kind: "move" });
	};
	const startPipResize = (direction) => (event) => {
		beginPipInteraction(event, {
			kind: "resize",
			direction
		});
	};
	const copyUpdateCmd = () => {
		const cmd = "dsh plugin --profile web add -w github:AwesomeHou/dsh-doudizhu";
		const done = () => {
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1600);
		};
		if (navigator.clipboard?.writeText) navigator.clipboard.writeText(cmd).then(done).catch(done);
		else done();
	};
	const enterOnline = () => {
		setOnline(true);
		setSyncing(true);
		syncRef.current = (async () => {
			try {
				const h = await health();
				if (h.protocol !== 2) {
					setVersionError({
						clientProtocol: 2,
						serverProtocol: h.protocol,
						serverVersion: h.version
					});
					setOnline(false);
					return;
				}
				await auth(profile.uid);
				const me = await getMe();
				setBalance(me.player.balance);
				setClaimed(me.player.claimedToday);
				setProfile((p) => ({
					...p,
					nickname: me.player.nickname,
					avatarId: me.player.avatarId
				}));
			} catch (e) {
				setNotice(e instanceof Error ? e.message : "在线连接失败");
				setOnline(false);
			} finally {
				setSyncing(false);
			}
		})();
	};
	(0, react.useEffect)(() => {
		enterOnline();
	}, []);
	(0, react.useEffect)(() => {
		if (!notice) return;
		const t = window.setTimeout(() => setNotice(null), 2600);
		return () => window.clearTimeout(t);
	}, [notice]);
	const claim = async () => {
		if (claimed) return;
		try {
			const r = await claimDaily();
			setBalance(r.balance);
			setClaimed(true);
			setNotice(`每日签到 +${r.amount.toLocaleString()}`);
		} catch (e) {
			if (e instanceof Error && e.message.includes("already claimed") || String(e).includes("409")) {
				setClaimed(true);
				try {
					const me = await getMe();
					setBalance(me.player.balance);
				} catch {}
				setNotice("今天已经签到过了，明天再来吧");
			} else setNotice(e instanceof Error ? e.message : "签到失败");
		}
	};
	const rescue$1 = async () => {
		if (rescued || !online) return;
		try {
			const r = await rescue();
			setBalance(r.balance);
			setRescued(true);
			setNotice(`救济金 +${r.amount.toLocaleString()}`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : "";
			if (msg.includes("already rescued") || String(e).includes("409")) setRescued(true);
			else if (!msg.includes("not low enough")) setNotice(msg || "领取失败");
		}
	};
	const startOnline = async (tid) => {
		if (syncRef.current) await syncRef.current;
		if (!online) {
			setNotice("在线状态未就绪，请重试");
			return;
		}
		setTableId(tid);
		setResult(null);
		setMatching(true);
		setMatchCount(1);
		try {
			const r = await joinQueue(tid);
			if (r.status === "matched") {
				setMatchCount(3);
				setRoomId(r.roomId);
				setMatching(false);
				setScreen("table");
				return;
			}
			setMatchCount(r.count);
			pollTimerRef.current = window.setInterval(async () => {
				try {
					const s = await pollQueue(tid);
					if (s.status === "matched") {
						if (pollTimerRef.current !== null) window.clearInterval(pollTimerRef.current);
						setRoomId(s.roomId);
						setMatching(false);
						setScreen("table");
					} else setMatchCount(s.count);
				} catch {}
			}, 2e3);
		} catch (e) {
			setMatching(false);
			setNotice(e instanceof Error ? e.message : "匹配失败");
		}
	};
	const cancelMatch = () => {
		if (pollTimerRef.current !== null) {
			window.clearInterval(pollTimerRef.current);
			pollTimerRef.current = null;
		}
		setMatching(false);
		if (online) leaveQueue(tableId).catch(() => void 0);
	};
	const updateProfile$1 = (next) => {
		const normalized = {
			...next,
			nickname: limitNickname(next.nickname)
		};
		setProfile(normalized);
		saveProfile(normalized);
		if (online) updateProfile(normalized.nickname, normalized.avatarId).catch(() => void 0);
	};
	const onSettledOnline = (0, react.useCallback)((myDelta, balanceAfter, winner, spring, multiplier, rake) => {
		setResult({
			myDelta,
			multiplier,
			winner,
			spring,
			rake
		});
		setBalance(balanceAfter);
	}, []);
	const exitTable = () => {
		setRoomId(null);
		setResult(null);
		setScreen("lobby");
	};
	const requestPip = () => {
		setStandaloneOpen(false);
		setOpen(true);
	};
	const toggleStandalone = () => {
		setOpen(false);
		setStandaloneOpen((current) => !current);
	};
	const closeSurface = () => {
		if (standaloneOpen) setStandaloneOpen(false);
		else setOpen(false);
	};
	const panelContent = (0, react.createElement)(react.Fragment, null, screen === "lobby" && (0, react.createElement)(Lobby, {
		profile,
		balance,
		claimed,
		online,
		matching,
		matchCount,
		rescued,
		syncing,
		lobbyLatency: lobbyLatencyMs,
		onClaim: claim,
		onRescue: rescue$1,
		onRetryConnect: enterOnline,
		onStartOnline: startOnline,
		onCancelMatch: cancelMatch,
		onProfileChange: updateProfile$1,
		onClose: closeSurface
	}), screen === "table" && roomId && (0, react.createElement)(OnlineTable, {
		roomId,
		tableId,
		profile,
		onExit: exitTable,
		onSettled: onSettledOnline
	}), screen === "table" && result && (0, react.createElement)(SettleDialog, {
		result,
		balance,
		onExit: exitTable
	}));
	return (0, react.createElement)("div", {
		className: "ddz-root",
		"data-host-modal": hostModal ? "true" : void 0
	}, (0, react.createElement)("style", null, STYLE), notice && (0, react.createElement)("div", {
		className: "ddz-toast",
		onClick: () => setNotice(null)
	}, notice), versionError && (0, react.createElement)("div", { className: "ddz-dialog" }, (0, react.createElement)("div", {
		className: "ddz-dialog-card",
		role: "alertdialog",
		"aria-label": "版本不兼容",
		"aria-modal": "true"
	}, (0, react.createElement)("h3", { className: "ddz-dialog-title" }, "版本不兼容，需要更新"), (0, react.createElement)("div", { className: "ddz-dialog-body" }, "在线对战要求客户端与服务器协议一致。当前客户端协议 v" + versionError.clientProtocol + " ≠ 服务器 v" + versionError.serverProtocol + "（服务器版本 " + versionError.serverVersion + "）。请更新插件后重试。", (0, react.createElement)("code", { className: "ddz-dialog-code" }, "dsh plugin --profile web add -w github:AwesomeHou/dsh-doudizhu")), (0, react.createElement)("div", {
		className: "ddz-row",
		style: {
			justifyContent: "flex-end",
			gap: 10
		}
	}, (0, react.createElement)("button", {
		className: "ddz-btn ddz-btn-ghost",
		onClick: copyUpdateCmd
	}, copied ? "已复制 ✓" : "复制更新命令"), (0, react.createElement)("button", {
		className: "ddz-btn",
		onClick: () => setVersionError(null)
	}, "我知道了")))), (0, react.createElement)(SidebarEntry, {
		onOpen: toggleStandalone,
		active: standaloneOpen || open
	}), standaloneOpen && (0, react.createElement)("div", {
		className: "ddz-standalone-surface",
		role: "main",
		"aria-label": "斗地主独立工作区",
		style: { left: sidebarRight }
	}, (0, react.createElement)("div", { className: "ddz-conversation-page" }, (0, react.createElement)("button", {
		type: "button",
		className: "ddz-conversation-popout",
		onClick: requestPip,
		"aria-label": "打开斗地主画中画小窗"
	}, "小窗"), (0, react.createElement)("div", { className: "ddz-modal" }, panelContent))), open && (0, react.createElement)("div", {
		className: "ddz-pip-window",
		role: "dialog",
		"aria-label": "斗地主画中画小窗",
		style: {
			left: pipBounds.left,
			top: pipBounds.top,
			width: pipBounds.width,
			height: pipBounds.height
		}
	}, (0, react.createElement)("div", { className: "ddz-modal" }, (0, react.createElement)("div", {
		className: "ddz-pip-toolbar",
		onPointerDown: startPipMove
	}, (0, react.createElement)("span", null, "斗地主"), (0, react.createElement)("div", { className: "ddz-pip-toolbar-actions" }, (0, react.createElement)("button", {
		type: "button",
		className: "ddz-pip-toolbar-btn",
		onClick: () => {
			setOpen(false);
			setStandaloneOpen(true);
		}
	}, "放回斗地主工作区"), (0, react.createElement)("button", {
		type: "button",
		className: "ddz-pip-toolbar-btn",
		"aria-label": "关闭斗地主小窗",
		onClick: () => setOpen(false)
	}, "×"))), (0, react.createElement)("div", { className: "ddz-pip-canvas" }, (0, react.createElement)("div", {
		ref: pipScaleRef,
		className: "ddz-pip-scale",
		style: { transform: `scale(${pipScale})` }
	}, panelContent))), [
		"n",
		"e",
		"s",
		"w",
		"ne",
		"nw",
		"se",
		"sw"
	].map((direction) => (0, react.createElement)("div", {
		key: direction,
		className: `ddz-pip-resize-handle is-${direction}`,
		"aria-hidden": true,
		onPointerDown: startPipResize(direction)
	}))));
}
//#endregion
//#region src/client/index.tsx
/**
* dsh-doudizhu 客户端入口
* 通过 body portal 挂载侧边栏入口、独立工作区与画中画小窗，不依赖 AI 会话或工作区。
* 入口采用与 dsh-better-sidebar 相同的 document.body + createRoot 挂载方式。
*/
/** 独立工作区只需要客户端运行时挂载能力。 */
const inject = [];
function apply(ctx) {
	ctx.effect(() => {
		const host = document.createElement("div");
		host.setAttribute("data-dsh-doudizhu", "");
		document.body.appendChild(host);
		const root = (0, react_dom_client.createRoot)(host);
		root.render((0, react.createElement)(DoudizhuApp));
		return () => {
			root.unmount();
			host.remove();
		};
	}, "dsh-doudizhu: mount");
}
//#endregion
exports.apply = apply;
exports.inject = inject;


		return module.exports;
	}
});