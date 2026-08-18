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
	/** 每日签到 Token */
	dailyTokens: 2e5,
	/** 破产救济金 */
	rescueTokens: 1e5,
	/** 平台抽水率 */
	rakeRate: .05,
	/** 每手出牌倒计时（ms） */
	turnTimeoutMs: 25e3,
	/** 桌别（门槛=底注×N，保证救济金 100k 可回到最低桌） */
	tables: [
		{
			id: "novice",
			label: "新手桌",
			base: 1e4,
			minBalance: 1e5
		},
		{
			id: "advanced",
			label: "进阶桌",
			base: 5e4,
			minBalance: 1e6
		},
		{
			id: "high",
			label: "高倍桌",
			base: 2e5,
			minBalance: 4e6
		}
	],
	/** 段位（按 Token 总余额） */
	ranks: [
		{
			id: 1,
			name: "小难梁",
			min: 0
		},
		{
			id: 2,
			name: "牢梁",
			min: 5e5
		},
		{
			id: 3,
			name: "梁子",
			min: 2e6
		},
		{
			id: 4,
			name: "梁圣",
			min: 1e7
		},
		{
			id: 5,
			name: "梁神",
			min: 5e7
		},
		{
			id: 6,
			name: "梁祖",
			min: 2e8
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
/**
* 斗地主规则引擎 —— 牌堆/洗牌/发牌
*/
const SUITS = [
	0,
	1,
	2,
	3
];
/** 构造一副 54 张的完整牌（13 点数 × 4 花色 + 大小王） */
function newDeck() {
	const deck = [];
	for (let r = 0; r < 13; r++) for (const s of SUITS) deck.push({
		r,
		s
	});
	deck.push({
		r: 13,
		s: 0
	}, {
		r: 14,
		s: 0
	});
	return deck;
}
/** Fisher–Yates 洗牌（rng 可注入以便测试） */
function shuffle(arr, rng = Math.random) {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const tmp = a[i];
		a[i] = a[j];
		a[j] = tmp;
	}
	return a;
}
/** 发牌：洗牌 → 17×3 + 3 底牌 */
function deal(rng = Math.random) {
	const deck = shuffle(newDeck(), rng);
	return {
		hands: [
			deck.slice(0, 17),
			deck.slice(17, 34),
			deck.slice(34, 51)
		],
		bottom: deck.slice(51, 54)
	};
}
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
//#region shared/engine/scoring.ts
/**
* @param landlord 地主座位
* @param winner 赢家阵营
* @param base 桌别底注
* @param multiplier 总倍数（抢地主 × 炸弹 × 春天）
* @param rakeRate 抽水率（0~1），默认 5%
*/
function settle(landlord, winner, base, multiplier, rakeRate = .05) {
	const stake = base * multiplier;
	const deltas = [
		0,
		0,
		0
	];
	const farmers = [
		0,
		1,
		2
	].filter((s) => s !== landlord);
	let rake = 0;
	if (winner === "landlord") {
		for (const f of farmers) deltas[f] = -stake;
		deltas[landlord] = 2 * stake;
		rake = Math.floor(2 * stake * rakeRate);
		deltas[landlord] -= rake;
	} else {
		deltas[landlord] = -2 * stake;
		for (const f of farmers) {
			const gain = Math.floor(stake * (1 - rakeRate));
			deltas[f] = gain;
			rake += stake - gain;
		}
	}
	return {
		landlord,
		winner,
		base,
		multiplier,
		stake,
		rake,
		deltas
	};
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
//#region shared/engine/game.ts
/**
* 斗地主规则引擎 —— 对局状态机（纯函数 reducer）
* 客户端与服务端共用：任何人出牌前，都必须先在这里校验并推进。
*/
function nextSeat(s) {
	return (s + 1) % 3;
}
function roleOf(state, seat) {
	return state.landlord === seat ? "landlord" : "farmer";
}
function createGame(rng = Math.random) {
	const { hands, bottom } = deal(rng);
	const order = [
		0,
		1,
		2
	];
	for (let i = order.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const tmp = order[i];
		order[i] = order[j];
		order[j] = tmp;
	}
	return {
		phase: "calling",
		hands,
		bottom,
		landlord: null,
		current: order[0],
		callActor: 0,
		callOrder: order,
		callMultiplier: 1,
		lastPlay: null,
		lastActor: null,
		lastPlayCards: null,
		passStreak: 0,
		multiplier: 1,
		bombCount: 0,
		playedEver: [
			false,
			false,
			false
		],
		landlordPlays: 0,
		spring: "none",
		winner: null,
		finished: false,
		redeal: false,
		moveLog: [],
		settlement: null,
		startedAt: Date.now()
	};
}
function clone(s) {
	return {
		...s,
		hands: s.hands.map((h) => [...h]),
		bottom: [...s.bottom],
		playedEver: [...s.playedEver],
		moveLog: [...s.moveLog]
	};
}
/** 出牌是否合法（服务端权威判断入口） */
function isLegalPlay(state, seat, cards) {
	if (state.phase !== "playing") return false;
	if (state.current !== seat) return false;
	if (cards.length === 0) return false;
	const play = classify(cards);
	if (!play) return false;
	const remain = state.hands[seat].slice();
	for (const c of cards) {
		const i = remain.findIndex((x) => x.r === c.r && x.s === c.s);
		if (i < 0) return false;
		remain.splice(i, 1);
	}
	return canBeat(play, state.lastPlay);
}
function applyAction(state, action) {
	const s = clone(state);
	if (action.type === "call") {
		if (s.phase !== "calling") throw new Error("phase not calling");
		if (s.callOrder[s.callActor] !== action.seat) throw new Error("not your turn to call");
		if (action.call) {
			if (s.landlord === null) {
				s.landlord = action.seat;
				s.callMultiplier = 1;
				s.moveLog.push({
					seat: action.seat,
					type: "call"
				});
			} else {
				s.landlord = action.seat;
				s.callMultiplier *= 2;
				s.moveLog.push({
					seat: action.seat,
					type: "rob"
				});
			}
		}
		s.callActor++;
		if (s.callActor >= 3) {
			if (s.landlord === null) s.redeal = true;
			else {
				s.phase = "playing";
				s.current = s.landlord;
				s.multiplier = s.callMultiplier;
			}
		} else s.current = s.callOrder[s.callActor];
		return s;
	}
	if (s.phase !== "playing" || s.current !== action.seat) throw new Error("not your turn");
	if (action.type === "play") {
		if (!isLegalPlay(s, action.seat, action.cards)) throw new Error("illegal play");
		const play = classify(action.cards);
		const hand = s.hands[action.seat];
		for (const c of action.cards) {
			const i = hand.findIndex((x) => x.r === c.r && x.s === c.s);
			hand.splice(i, 1);
		}
		s.lastPlay = play;
		s.lastActor = action.seat;
		s.lastPlayCards = action.cards;
		s.passStreak = 0;
		s.playedEver[action.seat] = true;
		if (roleOf(s, action.seat) === "landlord") s.landlordPlays++;
		if (play.kind === "bomb" || play.kind === "rocket") {
			s.bombCount++;
			s.multiplier *= 2;
		}
		s.moveLog.push({
			seat: action.seat,
			type: "play",
			cards: action.cards,
			play
		});
		if (hand.length === 0) {
			s.finished = true;
			s.winner = roleOf(s, action.seat);
			finalize(s);
		} else s.current = nextSeat(action.seat);
		return s;
	}
	if (s.lastPlay === null) throw new Error("cannot pass when leading");
	s.passStreak++;
	s.moveLog.push({
		seat: action.seat,
		type: "pass"
	});
	if (s.passStreak >= 2) {
		s.lastPlay = null;
		s.lastPlayCards = null;
		s.passStreak = 0;
		s.current = s.lastActor;
	} else s.current = nextSeat(action.seat);
	return s;
}
/** 结算（在 finished=true 时调用） */
function finalize(s, rakeRate = .05) {
	const landlord = s.landlord;
	const farmers = [
		0,
		1,
		2
	].filter((x) => x !== landlord);
	if (s.winner === "landlord") {
		if (!s.playedEver[farmers[0]] && !s.playedEver[farmers[1]]) s.spring = "landlord";
	} else if (s.landlordPlays <= 1) s.spring = "farmer";
	let mult = s.multiplier;
	if (s.spring !== "none") mult *= 2;
	s.multiplier = mult;
	s.settlement = settle(landlord, s.winner, 0, mult, rakeRate);
}
//#endregion
//#region shared/engine/bot.ts
/**
* 斗地主规则引擎 —— 简单机器人
* 目标：M1 阶段"看起来会打、能打完一局"，不追求强。
*/
/** 叫地主决策（机器人 / 服务端超时托管共用） */
function botCall(hand, random = Math.random) {
	return hand.filter((x) => x.r >= 12).length >= 1 || hand.filter((x) => x.r >= 9).length >= 3 || random() < .3;
}
/**
* 机器人出牌决策。
* @param hand 当前手牌
* @param last 上家的牌（null = 领出）
* @returns 要出的牌；null = 过
*/
function botMove(hand, last) {
	if (!last) {
		const h = hintPlay(hand, null);
		return h && h.length > 0 ? h : null;
	}
	const legal = legalPlays(hand, last);
	for (const p of legal) {
		const c = buildPlay(hand, p);
		if (c && c.length === hand.length) return c;
	}
	const h = hintPlay(hand, last);
	if (!h) return null;
	const kind = classify(h)?.kind;
	if ((kind === "bomb" || kind === "rocket") && hand.length > 4) return null;
	return h;
}
//#endregion
//#region src/client/brandAssets.ts
const deepseekBlueUrl = "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/PjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+PHN2ZyB0PSIxNzg3MDE4MDYyNzMyIiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEzOTEgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAtaWQ9IjI0ODgiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iMjcxLjY3OTY4NzUiIGhlaWdodD0iMjAwIj48cGF0aCBkPSJNMTI5OS43MTg3Mzk0OCAxMDkuMDgxNjQ4NTJjLTEyLjk0Njc2MzU2LTYuNDc0ODU0NjgtMTguNTM2NDA3MjEgNS44NjY1NDgyNy0yNi4wOTk3MzI2OCAxMi4xMzgxNDMxNy0yLjU3NzU2OTUzIDIuMDIzNzYwMzEtNC43NzgwNzc0NyA0LjY1NDM1NDEzLTYuOTc4NTg1NCA3LjA4MTY4ODE5LTE4LjkxNzg4NzUxIDIwLjYzNTI4NTI2LTQxLjAyMDE3ODA1IDM0LjE5MTgyODEyLTY5LjkyNzI1MjE5IDMyLjU3MzExNDQ1LTQyLjIzMzg0NTA4LTIuNDI3MzM0MDUtNzguMjk3NzI1MTMgMTEuMTI3NzM1OTEtMTEwLjE2Mzg0OTA4IDQ0LjEwNTg5NzAxLTYuNzc2Nzk4NTMtNDAuNjY2NjgyODItMjkuMjg1NjA4NjItNjQuOTQ0NDQyMDMtNjMuNTUyNTU0NDgtODAuNTIzMjcyMy0xNy45NTYwODU4My04LjA5MjA5NTQ1LTM2LjA2Mzg4MDA1LTE2LjE4NTY2MzgtNDguNjMzNTgyMDItMzMuNzg4MjU0MzgtOC43NDkwMDc0Ni0xMi41NDMxODk4LTExLjEyNzczNTkxLTI2LjUwMzMwNjQxLTE1LjUyNzI3ODg5LTQwLjI2MDE2MzI2LTIuNzgyMzAyMi04LjI5NTM1NTIyLTUuNTY0NjA0NDItMTYuNzkyNDk3MzEtMTQuOTIwNDQ1MzctMTguMjA5NDI0MTItMTAuMTkyNDQ2MzktMS42MTg3MTM2Ny0xNC4xNjMzNzYzNyA3LjA4MTY4ODE4LTE4LjE1OTM0NTYxIDE0LjM2NTE2MzI1LTE1LjkzMjMyNTUzIDI5Ljc0MDczMzc2LTIyLjEyODgwMjY5IDYyLjUxNzEwNzk5LTIxLjQ5NjkyOTkzIDk1LjY5NzA1NTk2IDEuMzY2ODQ4MzEgNzQuNjU2NzI0MDQgMzIuMjcxMTcwNTkgMTM0LjEzODE5MTU2IDkzLjYyNDY5MDAzIDE3Ni40MjM1ODgwNCA2Ljk4MDA1ODMgNC44NTQ2NjgxIDguNzc1NTE5NTkgOS43MTA4MDkxMiA2LjU3NTAxMTY3IDE2Ljc5MTAyNDQtNC4xNzI3MTY4NiAxNC41NjY5NTAxMS05LjE4MDU2NjI0IDI4LjczMDMyNjUtMTMuNTU1MDY5OTYgNDMuMjk3Mjc2NjMtMi43ODM3NzUwOSA5LjMwNzIzNTM3LTYuOTU1MDE5MDYgMTEuMzI5NTIyNzgtMTYuNzQyNDE4ODIgNy4yODM0NzUwNi0zMy42NjE1ODUyNC0xNC4zNjUxNjMyNS02Mi43NDU0MDctMzUuNjA4NzU0OTEtODguNDY1MTMyMjctNjEuMzAxOTY4MDUtNDMuNjI0MjU5NzMtNDMuMDk1NDg5NzUtODMuMDc3Mjc1NS05MC42NDA2MDA5Ny0xMzIuMjY2MTM5NjUtMTI3Ljg2NjU5NjY4YTU4MS42NzA1NDM0MyA1ODEuNjcwNTQzNDMgMCAwIDAtMzUuMDc3MDM5MTUtMjQuNDgxMDE5Yy01MC4yMDA3NDQyOS00OS43NzA2NTg0MSA2LjU3NTAxMTY3LTkwLjYzOTEyODA3IDE5LjcyNjUwNzg3LTk1LjQ5NTI2OTA4IDEzLjczMTgxNzU5LTUuMDU3OTI3ODggNC43Nzk1NTAzNy0yMi40NTcyNTg3LTM5LjY1NDgwMjYxLTIyLjI1NTQ3MTgzcy04NS4wNzU5OTY1NSAxNS4zNzcwNDM0LTEzNi44NzA0MTUyOSAzNS42MDg3NTQ5MmMtNy41ODU0MTg5MiAzLjAzNDE2NzU2LTE1LjU1Mzc5MTAzIDUuMjU5NzE0NzUtMjMuNjk1OTY0OTcgNy4wODE2ODgxOS00Ny4wMzk5MDc1OS05LjEwNTQ0ODQ5LTk1Ljg0ODc2NDM0LTExLjEyNzczNTkxLTE0Ni44NTk2MDE4OC01LjI2MTE4NzY0LTk2LjAyNTUxMTk1IDEwLjkyNTk0OTA1LTE3Mi43MzEwMzU1NSA1Ny4yNTczOTMyMy0yMjkuMTI2Nzg0MTQgMTM2LjM2MzczODc1LTY3LjcyNjc0NDI1IDk1LjA5MDIyMjQ0LTgzLjY4NTU4MTkyIDIwMy4xMzAxNTQyMi02NC4xMzU4MjE2NiAzMTUuODIxNDk0MzMgMjAuNDg1MDQ5NzggMTE4Ljc2MjYyMTA3IDc5Ljg4OTkyNjY2IDIxNy4wOTAyNzA4NCAxNzEuMTM3MzYxMTYgMjkzLjk3MTA2OTIgOTQuNjM1MDk3MyA3OS43MTMxNzkwMiAyMDMuNjEwMzE4NjIgMTE4Ljc2MjYyMTA3IDMyNy45MzYwNzExNSAxMTEuMjc3MzU5MTIgNzUuNTE1NDIyOTItNC40NTI1NjcyNSAxNTkuNTc5NTM5MzQtMTQuNzcwMjA5ODkgMjU0LjQxNjQyMzUyLTk2LjcxMDQwOTAxIDIzLjkyNDI2Mzk5IDEyLjEzOTYxNjA3IDQ5LjAzNzE1NTc0IDE2Ljk5NTc1NzA4IDkwLjY2NTY0MDIyIDIwLjYzNjc1ODE1IDMyLjA5Mjk1MDA3IDMuMDM0MTY3NTYgNjIuOTcyMjMzMTEtMS42MTg3MTM2NyA4Ni44NzE0NTc4Ny02LjY3NjY0MTUyIDM3LjQ1NDI5NDcxLTguMDkyMDk1NDUgMzQuODQ4NzQwMTMtNDMuNDk5MDYzNDkgMjEuMzE4NzA5NC00OS45NzI0NDUyOC0xMDkuNzgzODQxNy01Mi4xOTk0NjUzNS04NS42ODI4MzAwOS0zMC45NTU4NzM2Ny0xMDcuNTgzMzMzNzUtNDguMTUxOTQ0NzQgNTUuNzg4OTE1MDQtNjcuMzczMjQ4OTkgMTM5Ljg1MzAzMTQ2LTEzNy4zNzcwOTE4IDE3Mi43MzEwMzU1OC0zNjQuMTc2Njk4ODcgMi42MDQwODE2Ny0xOC4wMDYxNjQzMyAwLjQwMzU3Mzc1LTI5LjMzNTY4NzExIDAtNDMuOTAyNjM3MjMtMC4yMDMyNTk3Ny04LjkwMjE4ODczIDEuNzY4OTQ5MTQtMTIuMzQyODc1ODQgMTEuNzU5NjA4NjgtMTMuMzUzMjgzMSAyNy40OTAxNDczMy0zLjIzNzQyNzMzIDU0LjE5NjcxMzUxLTEwLjkyNTk0OTA1IDc4LjcwMjc3MTc1LTI0LjY4MjgwNTg3IDcxLjExNDQwNzA2LTM5LjY1NDgwMjY1IDk5LjgxODIyMTQyLTEwNC44MDI1MDQ0NiAxMDYuNTk2NDkyODUtMTgyLjg5ODQ0MjcxIDEuMDExODgwMTUtMTEuOTM2MzU2My0wLjIwMTc4Njg2LTI0LjI3Nzc1OTI0LTEyLjU2OTcwMTk1LTMwLjU0OTM1NDE1TTY3OS44ODY5MTA4MyA4MTEuOTQwNjc0MThjLTEwNi4zNjk2NjY3My04NS4zNzk0MTMzMy0xNTcuOTg3MzM3ODItMTEzLjUwMTQzMzQtMTc5LjMwNjA0NzIzLTExMi4yODc3NjYzOC0xOS45MjgyOTQ3NiAxLjIxMzY2NzAzLTE2LjMzNzM3MjE3IDI0LjQ4MTAxOTAyLTExLjk2Mjg2ODQ1IDM5LjY1NDgwMjYzIDQuNTc3NzYzNSAxNC45NzE5OTY3NyAxMC41NzA5ODA4OSAyNS4yODk2Mzk0IDE4Ljk0MTQ1Mzg4IDM4LjQ0MTEzNTYzIDUuNzY3ODY0MTcgOC43MDA0MDE4NiA5Ljc2MzgzMzQxIDIxLjY0ODYzODMxLTUuNzg5OTU3NjQgMzEuMzU5NDQ3NDItMzQuMjY4NDE4NzYgMjEuNjQ4NjM4MzEtOTMuODI2NDc2OTItNy4yODM0NzUwNi05Ni42MDczMDYyMy04LjY5ODkyODk3LTY5LjM0NTQ1NzktNDEuNjc4NTYyOTUtMTI3LjMzNjM1Mzc4LTk2LjcxMDQwOS0xNjguMTc5Nzg0MjMtMTcxLjk3MjQ5MzY3LTM5LjQ1MTU0Mjg4LTcyLjQzMTE3Njg3LTYyLjMzODg4NzQ3LTE1MC4xMjIwNjg1LTY2LjEzMzA2OTgyLTIzMy4wNzI2NzQ4NC0xLjAxMTg4MDE1LTIwLjAyOTkyNDY0IDQuNzc5NTUwMzctMjcuMTExNjEyODIgMjQuMjc5MjMyMTUtMzAuNzU0MDg2ODNhMjM1LjE5NjU5MjE2IDIzNS4xOTY1OTIxNiAwIDAgMSA3Ny45MTc3MTc3Ni0yLjAyMjI4NzRjMTA4LjU5NjY4NjgxIDE2LjE4NzEzNjY5IDIwMS4wNTYzMTU0MiA2NS43NTQ1MzUzMSAyNzguNTQzOTQ3MjUgMTQ0LjI1NTUyMDIyIDQ0LjIzMjU2NjE0IDQ0LjcxMTI1NzYyIDc3LjY5MDg5MTYzIDk4LjEyNDM5MDAxIDExMi4xODYxMzY0OSAxNTAuMzIzODU1MzYgMzYuNjQ1Njc0MzEgNTUuNDMzOTQ2OTEgNzYuMDk4NjkwMSAxMDguMjQwMjQ1NzYgMTI2LjI5OTQzNDQgMTUxLjUzNjA0OTQ4IDE3LjcyNzc4NjgyIDE1LjE3Mzc4MzY1IDMxLjg2NDY1MTA2IDI2LjcwNjU2NjIgNDUuNDE5NzIxMDEgMzUuMjAzNzA4MjgtNDAuODQzNDMwNDIgNC42NTQzNTQxMy0xMDguOTk4Nzg3NjUgNS42NjQ3NjEzOS0xNTUuNjA4NjA5MzQtMzEuOTY2MjgwOTNtNTEuMDA5MzY0NjgtMzM0LjgzOTUzODg0YzAtOC45MDIxODg3MyA2Ljk4MTUzMTItMTUuOTgzODc2OTMgMTUuNzU1NTc3ODgtMTUuOTgzODc2OTNxMi45ODQwODkwOCAwLjA1MTU1MTM4IDUuMzYxMzQ0NjUgMS4wMTE4ODAxNmExNS44NTcyMDc3OSAxNS44NTcyMDc3OSAwIDAgMSAxMC4xNjc0MDcxNiAxNC45NzE5OTY3NyAxNS43ODA2MTcxNSAxNS43ODA2MTcxNSAwIDAgMS0xNS43MzA1Mzg2NSAxNS45ODM4NzY5MiAxNS42MDM4Njk1MyAxNS42MDM4Njk1MyAwIDAgMS0xNS41NTM3OTEwNC0xNS45ODM4NzY5Mm0xNTguMzkyMzg0NDUgODIuOTUwNjA2MzZjLTEwLjE0MjM2NzkgNC4yNDkzMDc0OS0yMC4zMDgzMDIxNSA3Ljg5MTc4MTQ2LTMwLjA5NTcwMTg5IDguMjk1MzU1MjItMTUuMTIzNzA1MTQgMC44MTAwOTMyOC0zMS42NjI4NjQxOS01LjQ2MTUwMTYyLTQwLjYxNTEzMTQzLTEzLjE1MDAyMzMzLTEzLjk2MDExNjYxLTExLjkzNzgyOTE5LTIzLjkyNTczNjg5LTE4LjYxNDQ3MDczLTI4LjA5ODQ1MzczLTM5LjQ1MzAxNTc3LTEuNzk1NDYxMjktOC45MDIxODg3My0wLjgxMDA5MzI4LTIyLjY1OTA0NTU3IDAuNzg1MDU0MDQtMzAuNTQ5MzU0MTQgMy41OTA5MjI1OC0xNi45OTU3NTcwOC0wLjQwNTA0NjY1LTI3LjkyMDIzMzIxLTEyLjEzOTYxNjA3LTM3LjgzNDMwMjEtOS41NTkxMDA3NS04LjA5MzU2ODM1LTIxLjcyNTIyODk0LTEwLjMxOTExNTUzLTM1LjA3NzAzOTE1LTEwLjMxOTExNTUzLTQuOTgyODEwMTMgMC05LjU1OTEwMDc1LTIuMjI0MDc0MjktMTIuOTQ4MjM2NDYtNC4wNDYwNDc3MmExMy4yNzY2OTI0NiAxMy4yNzY2OTI0NiAwIDAgMS01Ljc2NjM5MTI2LTE4LjYxMjk5Nzg1YzEuMzkwNDE0NjYtMi44MzIzODA3IDguMTY4Njg2MDgtOS43MTIyODIwMiA5Ljc2MjM2MDQ5LTEwLjkyNTk0OTAzIDE4LjEzMTM2MDU4LTEwLjUyMDkwMjQxIDM5LjA0NjQ5NjIzLTcuMDgwMjE1MjkgNTguMzY3OTU3NDcgMC44MTAwOTMyOCAxNy45MzEwNDY1OSA3LjQ4NTI2MTk0IDMxLjQ2MTA3NzMxIDIxLjI0MzU5MTY3IDUxLjAxMDgzNzU5IDQwLjY2NjY4Mjc4IDE5LjkyODI5NDc2IDIzLjQ2OTEzODg1IDIzLjUxOTIxNzMzIDI5Ljk0Mzk5MzUzIDM0Ljg0ODc0MDEyIDQ3LjU0NTExMTI0IDguOTc4Nzc5MzYgMTMuNzU2ODU2ODUgMTcuMTQ3NDY1NDUgMjcuOTIwMjMzMjEgMjIuNzEyMDY5ODUgNDQuMTA0NDI0MSAzLjQxMjcwMjA2IDEwLjExNzMyODY1LTAuOTg2ODQwOTEgMTguNDExMjEwOTctMTIuNzQ2NDQ5NTcgMjMuNDY5MTM4ODUiIGZpbGw9IiM0RDZCRkUiIHAtaWQ9IjI0ODkiPjwvcGF0aD48L3N2Zz4=";
const deepseekBlackUrl = "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/PjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+PHN2ZyB0PSIxNzg3MDE5Nzk5MjY5IiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEzOTEgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAtaWQ9IjE2NjgiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iMjcxLjY3OTY4NzUiIGhlaWdodD0iMjAwIj48cGF0aCBkPSJNMTI5OS43MTg3Mzk0OCAxMDkuMDgxNjQ4NTJjLTEyLjk0Njc2MzU2LTYuNDc0ODU0NjgtMTguNTM2NDA3MjEgNS44NjY1NDgyNy0yNi4wOTk3MzI2OCAxMi4xMzgxNDMxNy0yLjU3NzU2OTUzIDIuMDIzNzYwMzEtNC43NzgwNzc0NyA0LjY1NDM1NDEzLTYuOTc4NTg1NCA3LjA4MTY4ODE5LTE4LjkxNzg4NzUxIDIwLjYzNTI4NTI2LTQxLjAyMDE3ODA1IDM0LjE5MTgyODEyLTY5LjkyNzI1MjE5IDMyLjU3MzExNDQ1LTQyLjIzMzg0NTA4LTIuNDI3MzM0MDUtNzguMjk3NzI1MTMgMTEuMTI3NzM1OTEtMTEwLjE2Mzg0OTA4IDQ0LjEwNTg5NzAxLTYuNzc2Nzk4NTMtNDAuNjY2NjgyODItMjkuMjg1NjA4NjItNjQuOTQ0NDQyMDMtNjMuNTUyNTU0NDgtODAuNTIzMjcyMy0xNy45NTYwODU4My04LjA5MjA5NTQ1LTM2LjA2Mzg4MDA1LTE2LjE4NTY2MzgtNDguNjMzNTgyMDItMzMuNzg4MjU0MzgtOC43NDkwMDc0Ni0xMi41NDMxODk4LTExLjEyNzczNTkxLTI2LjUwMzMwNjQxLTE1LjUyNzI3ODg5LTQwLjI2MDE2MzI2LTIuNzgyMzAyMi04LjI5NTM1NTIyLTUuNTY0NjA0NDItMTYuNzkyNDk3MzEtMTQuOTIwNDQ1MzctMTguMjA5NDI0MTItMTAuMTkyNDQ2MzktMS42MTg3MTM2Ny0xNC4xNjMzNzYzNyA3LjA4MTY4ODE4LTE4LjE1OTM0NTYxIDE0LjM2NTE2MzI1LTE1LjkzMjMyNTUzIDI5Ljc0MDczMzc2LTIyLjEyODgwMjY5IDYyLjUxNzEwNzk5LTIxLjQ5NjkyOTkzIDk1LjY5NzA1NTk2IDEuMzY2ODQ4MzEgNzQuNjU2NzI0MDQgMzIuMjcxMTcwNTkgMTM0LjEzODE5MTU2IDkzLjYyNDY5MDAzIDE3Ni40MjM1ODgwNCA2Ljk4MDA1ODMgNC44NTQ2NjgxIDguNzc1NTE5NTkgOS43MTA4MDkxMiA2LjU3NTAxMTY3IDE2Ljc5MTAyNDQtNC4xNzI3MTY4NiAxNC41NjY5NTAxMS05LjE4MDU2NjI0IDI4LjczMDMyNjUtMTMuNTU1MDY5OTYgNDMuMjk3Mjc2NjMtMi43ODM3NzUwOSA5LjMwNzIzNTM3LTYuOTU1MDE5MDYgMTEuMzI5NTIyNzgtMTYuNzQyNDE4ODIgNy4yODM0NzUwNi0zMy42NjE1ODUyNC0xNC4zNjUxNjMyNS02Mi43NDU0MDctMzUuNjA4NzU0OTEtODguNDY1MTMyMjctNjEuMzAxOTY4MDUtNDMuNjI0MjU5NzMtNDMuMDk1NDg5NzUtODMuMDc3Mjc1NS05MC42NDA2MDA5Ny0xMzIuMjY2MTM5NjUtMTI3Ljg2NjU5NjY4YTU4MS42NzA1NDM0MyA1ODEuNjcwNTQzNDMgMCAwIDAtMzUuMDc3MDM5MTUtMjQuNDgxMDE5Yy01MC4yMDA3NDQyOS00OS43NzA2NTg0MSA2LjU3NTAxMTY3LTkwLjYzOTEyODA3IDE5LjcyNjUwNzg3LTk1LjQ5NTI2OTA4IDEzLjczMTgxNzU5LTUuMDU3OTI3ODggNC43Nzk1NTAzNy0yMi40NTcyNTg3LTM5LjY1NDgwMjYxLTIyLjI1NTQ3MTgzcy04NS4wNzU5OTY1NSAxNS4zNzcwNDM0LTEzNi44NzA0MTUyOSAzNS42MDg3NTQ5MmMtNy41ODU0MTg5MiAzLjAzNDE2NzU2LTE1LjU1Mzc5MTAzIDUuMjU5NzE0NzUtMjMuNjk1OTY0OTcgNy4wODE2ODgxOS00Ny4wMzk5MDc1OS05LjEwNTQ0ODQ5LTk1Ljg0ODc2NDM0LTExLjEyNzczNTkxLTE0Ni44NTk2MDE4OC01LjI2MTE4NzY0LTk2LjAyNTUxMTk1IDEwLjkyNTk0OTA1LTE3Mi43MzEwMzU1NSA1Ny4yNTczOTMyMy0yMjkuMTI2Nzg0MTQgMTM2LjM2MzczODc1LTY3LjcyNjc0NDI1IDk1LjA5MDIyMjQ0LTgzLjY4NTU4MTkyIDIwMy4xMzAxNTQyMi02NC4xMzU4MjE2NiAzMTUuODIxNDk0MzMgMjAuNDg1MDQ5NzggMTE4Ljc2MjYyMTA3IDc5Ljg4OTkyNjY2IDIxNy4wOTAyNzA4NCAxNzEuMTM3MzYxMTYgMjkzLjk3MTA2OTIgOTQuNjM1MDk3MyA3OS43MTMxNzkwMiAyMDMuNjEwMzE4NjIgMTE4Ljc2MjYyMTA3IDMyNy45MzYwNzExNSAxMTEuMjc3MzU5MTIgNzUuNTE1NDIyOTItNC40NTI1NjcyNSAxNTkuNTc5NTM5MzQtMTQuNzcwMjA5ODkgMjU0LjQxNjQyMzUyLTk2LjcxMDQwOTAxIDIzLjkyNDI2Mzk5IDEyLjEzOTYxNjA3IDQ5LjAzNzE1NTc0IDE2Ljk5NTc1NzA4IDkwLjY2NTY0MDIyIDIwLjYzNjc1ODE1IDMyLjA5Mjk1MDA3IDMuMDM0MTY3NTYgNjIuOTcyMjMzMTEtMS42MTg3MTM2NyA4Ni44NzE0NTc4Ny02LjY3NjY0MTUyIDM3LjQ1NDI5NDcxLTguMDkyMDk1NDUgMzQuODQ4NzQwMTMtNDMuNDk5MDYzNDkgMjEuMzE4NzA5NC00OS45NzI0NDUyOC0xMDkuNzgzODQxNy01Mi4xOTk0NjUzNS04NS42ODI4MzAwOS0zMC45NTU4NzM2Ny0xMDcuNTgzMzMzNzUtNDguMTUxOTQ0NzQgNTUuNzg4OTE1MDQtNjcuMzczMjQ4OTkgMTM5Ljg1MzAzMTQ2LTEzNy4zNzcwOTE4IDE3Mi43MzEwMzU1OC0zNjQuMTc2Njk4ODcgMi42MDQwODE2Ny0xOC4wMDYxNjQzMyAwLjQwMzU3Mzc1LTI5LjMzNTY4NzExIDAtNDMuOTAyNjM3MjMtMC4yMDMyNTk3Ny04LjkwMjE4ODczIDEuNzY4OTQ5MTQtMTIuMzQyODc1ODQgMTEuNzU5NjA4NjgtMTMuMzUzMjgzMSAyNy40OTAxNDczMy0zLjIzNzQyNzMzIDU0LjE5NjcxMzUxLTEwLjkyNTk0OTA1IDc4LjcwMjc3MTc1LTI0LjY4MjgwNTg3IDcxLjExNDQwNzA2LTM5LjY1NDgwMjY1IDk5LjgxODIyMTQyLTEwNC44MDI1MDQ0NiAxMDYuNTk2NDkyODUtMTgyLjg5ODQ0MjcxIDEuMDExODgwMTUtMTEuOTM2MzU2My0wLjIwMTc4Njg2LTI0LjI3Nzc1OTI0LTEyLjU2OTcwMTk1LTMwLjU0OTM1NDE1TTY3OS44ODY5MTA4MyA4MTEuOTQwNjc0MThjLTEwNi4zNjk2NjY3My04NS4zNzk0MTMzMy0xNTcuOTg3MzM3ODItMTEzLjUwMTQzMzQtMTc5LjMwNjA0NzIzLTExMi4yODc3NjYzOC0xOS45MjgyOTQ3NiAxLjIxMzY2NzAzLTE2LjMzNzM3MjE3IDI0LjQ4MTAxOTAyLTExLjk2Mjg2ODQ1IDM5LjY1NDgwMjYzIDQuNTc3NzYzNSAxNC45NzE5OTY3NyAxMC41NzA5ODA4OSAyNS4yODk2Mzk0IDE4Ljk0MTQ1Mzg4IDM4LjQ0MTEzNTYzIDUuNzY3ODY0MTcgOC43MDA0MDE4NiA5Ljc2MzgzMzQxIDIxLjY0ODYzODMxLTUuNzg5OTU3NjQgMzEuMzU5NDQ3NDItMzQuMjY4NDE4NzYgMjEuNjQ4NjM4MzEtOTMuODI2NDc2OTItNy4yODM0NzUwNi05Ni42MDczMDYyMy04LjY5ODkyODk3LTY5LjM0NTQ1NzktNDEuNjc4NTYyOTUtMTI3LjMzNjM1Mzc4LTk2LjcxMDQwOS0xNjguMTc5Nzg0MjMtMTcxLjk3MjQ5MzY3LTM5LjQ1MTU0Mjg4LTcyLjQzMTE3Njg3LTYyLjMzODg4NzQ3LTE1MC4xMjIwNjg1LTY2LjEzMzA2OTgyLTIzMy4wNzI2NzQ4NC0xLjAxMTg4MDE1LTIwLjAyOTkyNDY0IDQuNzc5NTUwMzctMjcuMTExNjEyODIgMjQuMjc5MjMyMTUtMzAuNzU0MDg2ODNhMjM1LjE5NjU5MjE2IDIzNS4xOTY1OTIxNiAwIDAgMSA3Ny45MTc3MTc3Ni0yLjAyMjI4NzRjMTA4LjU5NjY4NjgxIDE2LjE4NzEzNjY5IDIwMS4wNTYzMTU0MiA2NS43NTQ1MzUzMSAyNzguNTQzOTQ3MjUgMTQ0LjI1NTUyMDIyIDQ0LjIzMjU2NjE0IDQ0LjcxMTI1NzYyIDc3LjY5MDg5MTYzIDk4LjEyNDM5MDAxIDExMi4xODYxMzY0OSAxNTAuMzIzODU1MzYgMzYuNjQ1Njc0MzEgNTUuNDMzOTQ2OTEgNzYuMDk4NjkwMSAxMDguMjQwMjQ1NzYgMTI2LjI5OTQzNDQgMTUxLjUzNjA0OTQ4IDE3LjcyNzc4NjgyIDE1LjE3Mzc4MzY1IDMxLjg2NDY1MTA2IDI2LjcwNjU2NjIgNDUuNDE5NzIxMDEgMzUuMjAzNzA4MjgtNDAuODQzNDMwNDIgNC42NTQzNTQxMy0xMDguOTk4Nzg3NjUgNS42NjQ3NjEzOS0xNTUuNjA4NjA5MzQtMzEuOTY2MjgwOTNtNTEuMDA5MzY0NjgtMzM0LjgzOTUzODg0YzAtOC45MDIxODg3MyA2Ljk4MTUzMTItMTUuOTgzODc2OTMgMTUuNzU1NTc3ODgtMTUuOTgzODc2OTNxMi45ODQwODkwOCAwLjA1MTU1MTM4IDUuMzYxMzQ0NjUgMS4wMTE4ODAxNmExNS44NTcyMDc3OSAxNS44NTcyMDc3OSAwIDAgMSAxMC4xNjc0MDcxNiAxNC45NzE5OTY3NyAxNS43ODA2MTcxNSAxNS43ODA2MTcxNSAwIDAgMS0xNS43MzA1Mzg2NSAxNS45ODM4NzY5MiAxNS42MDM4Njk1MyAxNS42MDM4Njk1MyAwIDAgMS0xNS41NTM3OTEwNC0xNS45ODM4NzY5Mm0xNTguMzkyMzg0NDUgODIuOTUwNjA2MzZjLTEwLjE0MjM2NzkgNC4yNDkzMDc0OS0yMC4zMDgzMDIxNSA3Ljg5MTc4MTQ2LTMwLjA5NTcwMTg5IDguMjk1MzU1MjItMTUuMTIzNzA1MTQgMC44MTAwOTMyOC0zMS42NjI4NjQxOS01LjQ2MTUwMTYyLTQwLjYxNTEzMTQzLTEzLjE1MDAyMzMzLTEzLjk2MDExNjYxLTExLjkzNzgyOTE5LTIzLjkyNTczNjg5LTE4LjYxNDQ3MDczLTI4LjA5ODQ1MzczLTM5LjQ1MzAxNTc3LTEuNzk1NDYxMjktOC45MDIxODg3My0wLjgxMDA5MzI4LTIyLjY1OTA0NTU3IDAuNzg1MDU0MDQtMzAuNTQ5MzU0MTQgMy41OTA5MjI1OC0xNi45OTU3NTcwOC0wLjQwNTA0NjY1LTI3LjkyMDIzMzIxLTEyLjEzOTYxNjA3LTM3LjgzNDMwMjEtOS41NTkxMDA3NS04LjA5MzU2ODM1LTIxLjcyNTIyODk0LTEwLjMxOTExNTUzLTM1LjA3NzAzOTE1LTEwLjMxOTExNTUzLTQuOTgyODEwMTMgMC05LjU1OTEwMDc1LTIuMjI0MDc0MjktMTIuOTQ4MjM2NDYtNC4wNDYwNDc3MmExMy4yNzY2OTI0NiAxMy4yNzY2OTI0NiAwIDAgMS01Ljc2NjM5MTI2LTE4LjYxMjk5Nzg1YzEuMzkwNDE0NjYtMi44MzIzODA3IDguMTY4Njg2MDgtOS43MTIyODIwMiA5Ljc2MjM2MDQ5LTEwLjkyNTk0OTAzIDE4LjEzMTM2MDU4LTEwLjUyMDkwMjQxIDM5LjA0NjQ5NjIzLTcuMDgwMjE1MjkgNTguMzY3OTU3NDcgMC44MTAwOTMyOCAxNy45MzEwNDY1OSA3LjQ4NTI2MTk0IDMxLjQ2MTA3NzMxIDIxLjI0MzU5MTY3IDUxLjAxMDgzNzU5IDQwLjY2NjY4Mjc4IDE5LjkyODI5NDc2IDIzLjQ2OTEzODg1IDIzLjUxOTIxNzMzIDI5Ljk0Mzk5MzUzIDM0Ljg0ODc0MDEyIDQ3LjU0NTExMTI0IDguOTc4Nzc5MzYgMTMuNzU2ODU2ODUgMTcuMTQ3NDY1NDUgMjcuOTIwMjMzMjEgMjIuNzEyMDY5ODUgNDQuMTA0NDI0MSAzLjQxMjcwMjA2IDEwLjExNzMyODY1LTAuOTg2ODQwOTEgMTguNDExMjEwOTctMTIuNzQ2NDQ5NTcgMjMuNDY5MTM4ODUiIGZpbGw9IiMyYzJjMmMiIHAtaWQ9IjE2NjkiPjwvcGF0aD48L3N2Zz4=";
//#endregion
//#region shared/protocol.ts
/** 应用版本（须与根 package.json version 同步） */
const APP_VERSION = "0.2.0";
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
		protocol: String(1),
		app: APP_VERSION
	});
	return new WebSocket(`${base}/ws/room/${encodeURIComponent(roomId)}?${params.toString()}`);
}
//#endregion
//#region src/client/table-view.ts
/** 本地引擎状态 → 视图（人类恒为 0 号座位） */
function tableViewFromEngine(s, mySeat, seatMeta) {
	const landlord = s.landlord;
	const seats = [
		0,
		1,
		2
	].map((seat) => {
		const meta = seatMeta[seat] ?? {
			nickname: `座位${seat}`,
			avatarId: "default-01",
			tokenBalance: 0
		};
		return {
			seat,
			nickname: meta.nickname,
			avatarId: meta.avatarId,
			handCount: s.hands[seat].length,
			role: landlord === null ? null : seat === landlord ? "landlord" : "farmer",
			connected: true,
			tokenBalance: meta.tokenBalance,
			isHuman: seat === mySeat
		};
	});
	return {
		phase: s.phase,
		mySeat,
		myHand: s.hands[mySeat].map((c) => ({ ...c })),
		bottom: landlord === null ? [] : s.bottom.map((c) => ({ ...c })),
		landlord,
		current: s.current,
		callOrder: s.callOrder,
		callActor: s.callActor,
		callMultiplier: s.callMultiplier,
		lastPlayCards: s.lastPlayCards ? s.lastPlayCards.map((c) => ({ ...c })) : null,
		lastActor: s.lastActor,
		multiplier: s.multiplier,
		bombCount: s.bombCount,
		spring: s.spring,
		finished: s.finished,
		winner: s.winner,
		seats,
		turnStartedAt: Date.now(),
		turnTimeoutMs: 25e3
	};
}
/** 线上 WS 状态 → 视图 */
function tableViewFromProtocol(p) {
	return {
		phase: p.phase,
		mySeat: p.seat,
		myHand: p.hand.map((c) => ({
			r: c.r,
			s: c.s
		})),
		bottom: p.bottom.map((c) => ({
			r: c.r,
			s: c.s
		})),
		landlord: p.landlord,
		current: p.current,
		callOrder: p.callOrder.map((s) => s),
		callActor: p.callActor,
		callMultiplier: p.callMultiplier,
		lastPlayCards: p.lastPlayCards ? p.lastPlayCards.map((c) => ({
			r: c.r,
			s: c.s
		})) : null,
		lastActor: p.lastActor,
		multiplier: p.multiplier,
		bombCount: p.bombCount,
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
			isHuman: s.seat === p.seat
		})),
		turnStartedAt: p.turnStartedAt,
		turnTimeoutMs: p.turnTimeoutMs
	};
}
//#endregion
//#region src/client/App.tsx
/**
* dsh-doudizhu 客户端主界面（M1 本地 + M2 在线）
* - 浮动入口按钮 + 全屏对局面板（body portal）
* - 大厅：昵称/头像/段位/余额、每日签到、桌别选择、本地/在线模式切换
* - 牌桌（本地机器人 or 线上真人 PVP）：叫地主/抢地主 → 出牌/过/提示 → 结算
* - 经济：本地 localStorage 模拟；在线走 Cloudflare Worker（服务端权威记账）
*/
const STYLE = `
.ddz-root{--dz-blue:#4d6bfe;--dz-blue-hover:#405de0;--dz-bg:#f5f7fa;--dz-panel:#fff;--dz-surface:#fff;--dz-table:#f7f8fb;--dz-line:#e4e7ed;--dz-text:#20242c;--dz-dim:#6f7684;--dz-red:#c53f4d;--dz-red-soft:#fff0f1;--dz-gold:#966813;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--dz-text);color-scheme:light;}
.ddz-btn{background:var(--dz-blue);border:0;border-radius:9px;color:#fff;font-size:14px;line-height:20px;padding:9px 18px;cursor:pointer;font-weight:650;transition:background-color .18s ease,transform .18s ease,box-shadow .18s ease}
.ddz-btn:hover{background:var(--dz-blue-hover);transform:translateY(-1px)}
.ddz-btn:active{transform:translateY(1px)}
.ddz-btn:focus-visible,.ddz-tab:focus-visible,.ddz-card:focus-visible,.ddz-float:focus-visible{outline:3px solid rgba(77,107,254,.28);outline-offset:2px}
.ddz-btn:disabled{background:#b7becb;cursor:not-allowed}
.ddz-btn-ghost{background:var(--dz-panel);border:1px solid var(--dz-line);color:var(--dz-text)}
.ddz-btn-ghost:hover{background:#f7f8fb;color:var(--dz-text)}
.ddz-btn-red{background:var(--dz-red)}
.ddz-float{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:8px;background:var(--dz-blue);color:#fff;border:0;border-radius:10px;padding:9px 14px;font-size:14px;line-height:20px;font-weight:650;cursor:pointer;box-shadow:0 7px 14px rgba(54,75,180,.25);transition:background-color .18s ease,transform .18s ease}
.ddz-float:hover{background:var(--dz-blue-hover);transform:translateY(-1px)}
.ddz-float-title{font-weight:650}
.ddz-float-subtitle{font-size:11px;line-height:16px;opacity:.82}
.ddz-overlay{position:fixed;inset:0;z-index:2147482999;background:rgba(28,32,42,.26);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);animation:ddz-overlay-in .22s ease-out both}
.ddz-modal{position:relative;background:var(--dz-panel);border-radius:18px;width:min(1180px,94vw);height:min(760px,92vh);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 18px 42px rgba(26,32,47,.18);animation:ddz-modal-in .32s cubic-bezier(.22,1,.36,1) both}
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
@media (max-width:720px){.ddz-modal{width:100vw;height:100vh;border-radius:0}.ddz-body{padding:16px}.ddz-corner-close{top:10px;right:12px}.ddz-table-exit{top:10px;left:12px}.ddz-table-reserved-bar{height:36px;flex-basis:36px}.ddz-lobby{padding:20px 16px 24px}.ddz-lobby-top{align-items:flex-start;flex-direction:column;margin-bottom:32px}.ddz-balance{width:auto;justify-content:flex-start}.ddz-balance-copy{align-items:flex-start}.ddz-table-grid{flex-direction:column}.ddz-table-grid .ddz-tab{flex-basis:auto}.ddz-top-reveal{min-height:64px}.ddz-table-middle{grid-template-columns:1fr 1.2fr 1fr;gap:6px}.ddz-side-zone{display:flex;flex-direction:column;gap:8px}.ddz-side-zone .ddz-play-area{min-height:72px}.ddz-table-center{min-height:110px;order:0}.ddz-seat{min-width:0}.ddz-card{width:38px;height:56px;font-size:18px}.ddz-card-rank{font-size:16px}.ddz-card-rank.long{font-size:14px}.ddz-card-corner.top{top:4px;left:4px}.ddz-card-corner.bottom{right:4px;bottom:4px}.ddz-folded-cards .ddz-card-stack-item:not(:first-child){margin-left:-20px}.ddz-table{padding:12px}.ddz-human-hand-row{flex-direction:column;align-items:center;gap:12px}.ddz-human-hand-row .ddz-seat{position:static}.ddz-human-hand{width:100%;flex:none;overflow-x:auto;justify-content:flex-start}.ddz-float{right:12px;bottom:12px}}
@media (prefers-reduced-motion:reduce){.ddz-btn,.ddz-float,.ddz-card{transition:none}.ddz-card:hover,.ddz-float:hover{transform:none}.ddz-card.sel{transform:translateY(-8px)}.ddz-overlay,.ddz-modal,.ddz-toast,.ddz-avatar-picker,.ddz-reveal-card,.ddz-played-card,.ddz-hand-card,.ddz-action-dock.is-active,.ddz-seat-chip.is-turn,.ddz-countdown.urgent,.ddz-special-play,.ddz-special-label{animation:none!important}}
`;
function CardView({ card, selected, onClick }) {
	const isRed = card.s === 1 || card.s === 2 || card.r >= 13;
	const label = cardName(card);
	const rank = card.r < 13 ? RANK_NAMES[card.r] : card.r === 13 ? "小王" : "大王";
	const suit = card.r < 13 ? SUIT_SYMBOLS[card.s] : "";
	const rankClass = rank.length > 1 ? " long" : "";
	return (0, react.createElement)("div", {
		className: "ddz-card" + (isRed ? " red" : "") + (selected ? " sel" : ""),
		role: onClick ? "button" : void 0,
		tabIndex: onClick ? 0 : void 0,
		"aria-label": onClick ? `选择${label}` : void 0,
		"aria-pressed": onClick ? selected : void 0,
		onClick,
		onKeyDown: onClick ? (event) => {
			if (event.key === "Enter" || event.key === " ") onClick();
		} : void 0
	}, (0, react.createElement)("span", { className: "ddz-card-corner top" }, (0, react.createElement)("span", { className: "ddz-card-rank" + rankClass }, rank), suit && (0, react.createElement)("span", { className: "ddz-card-suit" }, suit)), suit && (0, react.createElement)("span", {
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
function PlayedArea({ seat, cards, countdownSeconds = null }) {
	const cardKey = cards?.map((card) => `${card.r}-${card.s}`).join("|") ?? "empty";
	const play = cards ? classify(cards) : null;
	const isSpecialPlay = play !== null && ![
		"single",
		"pair",
		"triple"
	].includes(play.kind);
	const specialClass = isSpecialPlay && play ? ` ddz-special-play ddz-special-${play.kind}` : "";
	return (0, react.createElement)("div", {
		className: "ddz-play-area",
		"aria-label": `${seatLabel(seat, 0)}出牌区${play ? `，${KIND_NAMES[play.kind]}` : ""}`
	}, countdownSeconds !== null && (0, react.createElement)("span", {
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
	return ["下家", "上家"][seat < humanSeat ? 0 : 1] ?? "对手";
}
function GameTableShell(props) {
	const { view, selected, notice, remainingSeconds, onToggleCard, onPlay, onPass, onHint, onCall, onExit, onDismissNotice } = props;
	const [playedBySeat, setPlayedBySeat] = (0, react.useState)(() => [
		null,
		null,
		null
	]);
	(0, react.useEffect)(() => {
		if (view.lastPlayCards === null || view.lastPlayCards.length === 0) {
			if (view.lastActor !== null && view.phase === "playing") setPlayedBySeat([
				null,
				null,
				null
			]);
			return;
		}
		if (view.lastActor === null) return;
		const actor = view.lastActor;
		const cards = view.lastPlayCards;
		setPlayedBySeat((prev) => {
			if (prev[actor] === cards) return prev;
			const next = [...prev];
			next[actor] = cards;
			return next;
		});
	}, [
		view.phase,
		view.lastActor,
		view.lastPlayCards
	]);
	const sortedHand = (0, react.useMemo)(() => sortHand(view.myHand), [view.myHand]);
	const humanView = view.seats.find((s) => s.isHuman) ?? view.seats[view.mySeat];
	const otherSeats = view.seats.filter((s) => !s.isHuman);
	const botA = otherSeats[0];
	const botB = otherSeats[1];
	const isMyTurn = view.phase !== "settled" && !view.finished && view.current === view.mySeat;
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
	return (0, react.createElement)("div", { className: "ddz-body ddz-table-screen" }, (0, react.createElement)("button", {
		className: "ddz-table-exit",
		onClick: onExit
	}, "← 退出牌桌"), (0, react.createElement)("div", {
		className: "ddz-table-reserved-bar",
		"aria-hidden": true
	}), notice && view.phase !== "playing" && (0, react.createElement)("div", {
		className: "ddz-toast",
		onClick: onDismissNotice
	}, notice), (0, react.createElement)("div", { className: "ddz-table ddz-game-table" }, (0, react.createElement)("div", { className: "ddz-top-reveal" }, view.landlord !== null ? (0, react.createElement)("div", {
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
		isTurn: view.current === botA.seat
	}), botA && (0, react.createElement)(PlayedArea, {
		seat: botA.seat,
		cards: playedBySeat[botA.seat],
		countdownSeconds: view.current === botA.seat && showCountdown ? remainingSeconds : null
	})), (0, react.createElement)("div", {
		className: "ddz-table-center",
		style: { textAlign: "center" }
	}, (0, react.createElement)("div", { className: "ddz-table-turn-label" }, view.phase === "playing" ? isMyTurn ? "轮到你出牌" : "对手出牌中…" : "")), (0, react.createElement)("div", { className: "ddz-side-zone right" }, botB && (0, react.createElement)(PlayedArea, {
		seat: botB.seat,
		cards: playedBySeat[botB.seat],
		countdownSeconds: view.current === botB.seat && showCountdown ? remainingSeconds : null
	}), botB && (0, react.createElement)(SeatPanel, {
		view,
		seatView: botB,
		isTurn: view.current === botB.seat
	}))), (0, react.createElement)("div", {
		className: "ddz-human-area",
		style: { textAlign: "center" }
	}, (0, react.createElement)(PlayedArea, {
		seat: view.mySeat,
		cards: playedBySeat[view.mySeat]
	}), (0, react.createElement)("div", { className: "ddz-human-hand-row" }, humanView && (0, react.createElement)(SeatPanel, {
		view,
		seatView: humanView,
		isTurn: isMyTurn
	}), (0, react.createElement)("div", {
		className: "ddz-row ddz-hand ddz-folded-cards ddz-human-hand",
		style: {
			flexWrap: "nowrap",
			gap: 0,
			paddingBottom: 4
		}
	}, ...sortedHand.map((c, i) => (0, react.createElement)("div", {
		key: `${c.r}-${c.s}-${i}`,
		className: "ddz-hand-card ddz-card-stack-item",
		style: { "--ddz-delay": `${Math.min(i, 12) * 35}ms` }
	}, (0, react.createElement)(CardView, {
		card: c,
		selected: selected.some((x) => x.r === c.r && x.s === c.s),
		onClick: () => onToggleCard(c)
	}))))), (0, react.createElement)("div", {
		className: "ddz-action-dock ddz-row" + (isMyTurn ? " is-active" : ""),
		style: {
			justifyContent: "center",
			gap: 10,
			marginTop: 10
		}
	}, view.phase === "calling" ? isMyTurn ? (0, react.createElement)("div", {
		className: "ddz-row",
		style: { gap: 10 }
	}, (0, react.createElement)("button", {
		className: "ddz-btn",
		onClick: () => onCall(true)
	}, "叫地主"), (0, react.createElement)("button", {
		className: "ddz-btn ddz-btn-ghost",
		onClick: () => onCall(false)
	}, "不叫")) : (0, react.createElement)("span", { className: "ddz-action-status ddz-dim" }, "等待叫地主…") : view.phase === "playing" ? isMyTurn ? (0, react.createElement)("div", {
		className: "ddz-row",
		style: { gap: 10 }
	}, (0, react.createElement)("button", {
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
		onClick: onPass
	}, "过"), isMyTurn && showCountdown && (0, react.createElement)("span", {
		className: "ddz-countdown ddz-action-countdown" + ((remainingSeconds ?? 0) <= 3 ? " urgent" : ""),
		"aria-live": "polite"
	}, `${remainingSeconds}s`)) : (0, react.createElement)("span", { className: "ddz-action-status ddz-turn" }, "对手思考中…") : null))));
}
function SeatPanel(props) {
	const { view, seatView, isTurn } = props;
	const roundMultiplier = view.phase === "calling" ? view.callMultiplier : view.multiplier;
	const statusLabel = seatView.isHuman ? `倍率 ×${roundMultiplier}` : seatView.handCount + " 张手牌";
	const statusClass = seatView.isHuman ? "ddz-multiplier" : "ddz-card-count";
	return (0, react.createElement)("div", { className: "ddz-seat" }, (0, react.createElement)("div", { className: "ddz-seat-identity" }, (0, react.createElement)(PlayerRank, { tokenBalance: seatView.tokenBalance }), (0, react.createElement)("div", { className: "ddz-seat-chip" + (isTurn ? " is-turn" : "") }, (0, react.createElement)(Avatar, {
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
function loadBalance() {
	try {
		return Number(localStorage.getItem("ddz:balance") ?? 1e5);
	} catch {
		return 1e5;
	}
}
function saveBalance(v) {
	localStorage.setItem("ddz:balance", String(v));
}
function saveProfile(profile) {
	localStorage.setItem("ddz:profile", JSON.stringify(profile));
}
function todayKey() {
	const d = /* @__PURE__ */ new Date();
	return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function Lobby(props) {
	const { profile, balance, onClaim, claimed, online, matching, matchCount, rescued, onRescue, lobbyLatency, onModeChange, onStartLocal, onStartOnline, onCancelMatch, onProfileChange, onClose } = props;
	const rank = rankForBalance(balance);
	const minBalance = Math.min(...CONFIG.tables.map((t) => t.minBalance));
	const lobbyLatencyClass = lobbyLatency === null ? "" : lobbyLatency < 100 ? " good" : lobbyLatency < 250 ? " mid" : " bad";
	const [tableId, setTableId] = (0, react.useState)(CONFIG.tables[0].id);
	const [avatarPickerOpen, setAvatarPickerOpen] = (0, react.useState)(false);
	const [editingNickname, setEditingNickname] = (0, react.useState)(false);
	const [nicknameDraft, setNicknameDraft] = (0, react.useState)(profile.nickname);
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
	}, (0, react.createElement)(EditIcon))), (0, react.createElement)("div", { className: "ddz-dim ddz-profile-uid" }, "UID " + profile.uid.slice(0, 8))), (0, react.createElement)("span", { className: "ddz-rank" }, rank.name)), (0, react.createElement)("div", { className: "ddz-balance ddz-row" }, (0, react.createElement)("div", { className: "ddz-balance-copy" }, (0, react.createElement)("div", { className: "ddz-balance-label" }, "Token 余额" + (online ? "（在线）" : "")), (0, react.createElement)("div", { className: "ddz-balance-value" }, balance.toLocaleString())), (0, react.createElement)("button", {
		className: "ddz-btn ddz-balance-btn",
		disabled: claimed,
		onClick: onClaim
	}, claimed ? "今日已领" : `签到 +${CONFIG.dailyTokens.toLocaleString()}`)), online && balance < minBalance && (0, react.createElement)("div", {
		className: "ddz-row",
		style: { marginTop: 12 }
	}, rescued ? (0, react.createElement)("span", { className: "ddz-dim ddz-helper" }, "今日救济金已领") : (0, react.createElement)("button", {
		className: "ddz-btn ddz-btn-ghost",
		onClick: onRescue
	}, `领救济金 +${CONFIG.rescueTokens.toLocaleString()}`))), (0, react.createElement)("div", {
		className: "ddz-mode-switch",
		role: "group",
		"aria-label": "对局模式"
	}, (0, react.createElement)("button", {
		type: "button",
		className: "ddz-mode-btn" + (online ? "" : " on"),
		onClick: () => onModeChange(false)
	}, "本地练习"), (0, react.createElement)("button", {
		type: "button",
		className: "ddz-mode-btn" + (online ? " on" : ""),
		onClick: () => onModeChange(true)
	}, "在线对战")), online && (0, react.createElement)("div", {
		className: "ddz-lobby-latency" + lobbyLatencyClass,
		role: "status",
		title: "到在线服务器的网络延迟"
	}, (0, react.createElement)("span", { className: "ddz-latency-dot" }), (0, react.createElement)("span", null, "网络延迟 "), lobbyLatency === null ? (0, react.createElement)("span", null, "—") : (0, react.createElement)("b", null, `${lobbyLatency}ms`))), (0, react.createElement)("div", { className: "ddz-lobby-intro" }, (0, react.createElement)("div", { className: "ddz-section-title" }, "选择桌别"), (0, react.createElement)("div", { className: "ddz-dim ddz-lobby-subtitle" }, online ? "在线匹配 3 名真人玩家（Cloudflare 云端对局）" : "开局自动匹配 2 个本地机器人（M1 本地演示）")), (0, react.createElement)("div", { className: "ddz-table-grid" }, ...CONFIG.tables.map((t) => (0, react.createElement)("button", {
		key: t.id,
		type: "button",
		className: "ddz-tab" + (tableId === t.id ? " on" : ""),
		"aria-pressed": tableId === t.id,
		onClick: () => setTableId(t.id)
	}, (0, react.createElement)("div", { style: { fontWeight: 700 } }, t.label), (0, react.createElement)("div", {
		className: "ddz-dim",
		style: { fontSize: 12 }
	}, `底注 ${t.base.toLocaleString()} · 余额门槛 ${t.minBalance.toLocaleString()}`)))), (0, react.createElement)("div", { className: "ddz-lobby-actions" }, matching ? (0, react.createElement)("button", {
		className: "ddz-btn ddz-btn-red",
		onClick: onCancelMatch
	}, `匹配中… ${matchCount}/3（点击取消）`) : (0, react.createElement)("button", {
		className: "ddz-btn",
		disabled: balance < (online ? tableById(tableId)?.minBalance ?? 0 : tableById(tableId)?.base ?? 0),
		onClick: () => online ? onStartOnline(tableId) : onStartLocal(tableId)
	}, online ? "开始匹配" : "开始本地对局"), (0, react.createElement)("button", {
		className: "ddz-btn ddz-btn-ghost",
		onClick: onClose
	}, "最小化")), balance < (online ? tableById(tableId)?.minBalance ?? 0 : tableById(tableId)?.base ?? 0) && (0, react.createElement)("div", { className: "ddz-dim ddz-helper" }, online ? "余额不足该桌门槛，先签到或领救济金" : "余额不足该桌底注，先签到或换低倍桌")), (0, react.createElement)("div", { className: "ddz-lobby-version" }, `斗地主 v${APP_VERSION}`));
}
const HUMAN_SEAT = 0;
const LOCAL_SEAT_META = [
	{
		nickname: "你",
		avatarId: "default-01",
		tokenBalance: 0
	},
	{
		nickname: "机器人·蓝",
		avatarId: "default-01",
		tokenBalance: 358e5
	},
	{
		nickname: "机器人·黑",
		avatarId: "default-02",
		tokenBalance: 242e5
	}
];
function LocalTable(props) {
	const { tableId, base, profile, balance, onExit, onFinished } = props;
	const [state, setState] = (0, react.useState)(() => createGame());
	const [selected, setSelected] = (0, react.useState)([]);
	const [busy, setBusy] = (0, react.useState)(false);
	const randomRef = (0, react.useRef)(Math.random);
	const [notice, setNotice] = (0, react.useState)(null);
	const [turnStartedAt, setTurnStartedAt] = (0, react.useState)(null);
	const [clock, setClock] = (0, react.useState)(() => Date.now());
	const seatMeta = (0, react.useMemo)(() => LOCAL_SEAT_META.map((m, i) => i === HUMAN_SEAT ? {
		...m,
		nickname: profile.nickname,
		avatarId: profile.avatarId,
		tokenBalance: balance
	} : m), [
		profile.nickname,
		profile.avatarId,
		balance
	]);
	const view = (0, react.useMemo)(() => tableViewFromEngine(state, HUMAN_SEAT, seatMeta), [state, seatMeta]);
	(0, react.useEffect)(() => {
		if (state.phase !== "playing" || state.finished) {
			setTurnStartedAt(null);
			return;
		}
		const startedAt = Date.now();
		setTurnStartedAt(startedAt);
		setClock(startedAt);
	}, [
		state.phase,
		state.current,
		state.finished
	]);
	(0, react.useEffect)(() => {
		if (state.phase !== "playing" || state.finished || turnStartedAt === null) return;
		const timer = window.setInterval(() => setClock(Date.now()), 250);
		return () => window.clearInterval(timer);
	}, [
		state.phase,
		state.finished,
		turnStartedAt
	]);
	(0, react.useEffect)(() => {
		if (state.phase !== "playing" || state.current !== HUMAN_SEAT || state.finished || turnStartedAt === null) return;
		const timer = window.setTimeout(() => {
			setState((s) => {
				if (s.phase !== "playing" || s.current !== HUMAN_SEAT || s.finished) return s;
				const move = hintPlay(s.hands[HUMAN_SEAT], s.lastPlay);
				try {
					if (move) return applyAction(s, {
						type: "play",
						seat: HUMAN_SEAT,
						cards: move
					});
					if (s.lastPlay !== null) return applyAction(s, {
						type: "pass",
						seat: HUMAN_SEAT
					});
				} catch {}
				return s;
			});
			setSelected([]);
			setNotice("出牌超时，已自动处理");
		}, Math.max(0, turnStartedAt + CONFIG.turnTimeoutMs - Date.now()));
		return () => window.clearTimeout(timer);
	}, [
		state.phase,
		state.current,
		state.finished,
		state.lastPlay,
		turnStartedAt
	]);
	(0, react.useEffect)(() => {
		if (state.finished || state.redeal || state.phase === "settled") return;
		if (state.current === HUMAN_SEAT) return;
		const timer = window.setTimeout(() => {
			const seat = state.current;
			if (state.phase === "calling") {
				const call = botCall(state.hands[seat], randomRef.current);
				setState((s) => {
					try {
						return applyAction(s, {
							type: "call",
							seat,
							call
						});
					} catch {
						return s;
					}
				});
			} else {
				const move = botMove(state.hands[seat], state.lastPlay);
				setState((s) => {
					try {
						return move === null ? applyAction(s, {
							type: "pass",
							seat
						}) : applyAction(s, {
							type: "play",
							seat,
							cards: move
						});
					} catch {
						return s;
					}
				});
			}
		}, 650);
		return () => window.clearTimeout(timer);
	}, [state]);
	(0, react.useEffect)(() => {
		if (!state.finished || !state.settlement) return;
		const t = window.setTimeout(() => {
			const s = settle(state.landlord, state.winner, base, state.multiplier, CONFIG.rakeRate);
			const winnerText = state.winner === "landlord" ? "地主胜" : "农民胜";
			const springText = state.spring === "none" ? "无" : state.spring === "landlord" ? "春天" : "反春";
			onFinished(s.deltas, s.multiplier, winnerText, springText, state.landlord, s.rake);
		}, 900);
		return () => window.clearTimeout(t);
	}, [
		state.finished,
		state.settlement,
		state.winner,
		state.multiplier,
		state.spring,
		state.landlord,
		base,
		onFinished
	]);
	(0, react.useEffect)(() => {
		if (state.redeal) {
			const t = window.setTimeout(() => setState(createGame()), 800);
			return () => window.clearTimeout(t);
		}
	}, [state.redeal]);
	const toggleSelect = (card) => {
		if (state.phase !== "playing" || state.current !== HUMAN_SEAT) return;
		setSelected((prev) => {
			const idx = prev.findIndex((x) => x.r === card.r && x.s === card.s);
			if (idx >= 0) return prev.filter((_, i) => i !== idx);
			return [...prev, card];
		});
	};
	const humanAct = (action) => {
		try {
			if (action.type === "call") {
				setState((s) => applyAction(s, {
					type: "call",
					seat: HUMAN_SEAT,
					call: action.call
				}));
				setBusy(true);
				window.setTimeout(() => setBusy(false), 300);
			} else if (action.type === "pass") {
				setState((s) => applyAction(s, {
					type: "pass",
					seat: HUMAN_SEAT
				}));
				setSelected([]);
			} else {
				setState((s) => applyAction(s, {
					type: "play",
					seat: HUMAN_SEAT,
					cards: action.cards
				}));
				setSelected([]);
			}
		} catch (e) {
			setNotice(e instanceof Error ? e.message : String(e));
		}
	};
	const doHint = () => {
		if (state.phase !== "playing" || state.current !== HUMAN_SEAT) return;
		const h = hintPlay(state.hands[HUMAN_SEAT], state.lastPlay);
		if (!h) {
			setNotice("没有能压过的牌，过吧");
			return;
		}
		setSelected(h);
	};
	const remainingMs = state.phase === "playing" && turnStartedAt !== null ? Math.max(0, CONFIG.turnTimeoutMs - (clock - turnStartedAt)) : null;
	const remainingSeconds = remainingMs === null ? null : Math.ceil(remainingMs / 1e3);
	return (0, react.createElement)(GameTableShell, {
		view,
		selected,
		notice,
		remainingSeconds,
		onToggleCard: toggleSelect,
		onPlay: () => humanAct({
			type: "play",
			cards: selected
		}),
		onPass: () => humanAct({ type: "pass" }),
		onHint: doHint,
		onCall: (call) => humanAct({
			type: "call",
			call
		}),
		onExit,
		onDismissNotice: () => setNotice(null)
	});
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
				} else if (msg.t === "settle") onSettled(msg.d.myDelta, msg.d.balance_after, msg.d.winner, msg.d.spring, msg.d.multiplier, msg.d.rake);
				else if (msg.t === "pong") {
					const ts = msg.d.ts;
					if (ts !== void 0 && pingRef.current !== null) setLatencyMs(Math.max(0, Date.now() - ts));
					pingRef.current = null;
				} else if (msg.t === "error") setNotice(msg.d.message);
			});
			ws.addEventListener("close", () => {
				if (disposed) return;
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
	}, [roomId, onSettled]);
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
				v: 1,
				t: "ping",
				d: { ts }
			});
		}, 3e3);
		return () => window.clearInterval(timer);
	}, [send]);
	const remainingSeconds = view && !view.finished ? Math.max(0, Math.ceil((view.turnStartedAt + view.turnTimeoutMs - clock) / 1e3)) : null;
	const toggleSelect = (card) => {
		if (!view || view.finished || view.current !== view.mySeat) return;
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
				v: 1,
				t: "play",
				d: { cards: selected }
			});
			setSelected([]);
		},
		onPass: () => send({
			v: 1,
			t: "pass",
			d: {}
		}),
		onHint: doHint,
		onCall: (call) => send({
			v: 1,
			t: "call",
			d: { call }
		}),
		onExit,
		onDismissNotice: () => setNotice(null)
	}), latencyFooter);
}
function Settle(props) {
	const { result, balance, onExit } = props;
	const myDelta = result.myDelta;
	const win = myDelta > 0;
	return (0, react.createElement)("div", { className: "ddz-settle ddz-body" }, (0, react.createElement)("div", {
		className: "ddz-big",
		style: { color: win ? "var(--dz-gold)" : "var(--dz-red)" }
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
	}, "返回大厅")));
}
function DoudizhuApp() {
	const [open, setOpen] = (0, react.useState)(false);
	const [profile, setProfile] = (0, react.useState)(() => loadProfile());
	const [balance, setBalance] = (0, react.useState)(() => loadBalance());
	const [claimed, setClaimed] = (0, react.useState)(() => localStorage.getItem("ddz:claim") === todayKey());
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
	(0, react.useEffect)(() => {
		if (!online) {
			setLobbyLatencyMs(null);
			return;
		}
		let disposed = false;
		const ping = async () => {
			const start = Date.now();
			try {
				const h = await health();
				if (!disposed && h.ok) setLobbyLatencyMs(Date.now() - start);
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
	}, [online]);
	const copyUpdateCmd = () => {
		const cmd = "dsh plugin --profile web add -w github:AwesomeHou/dsh-doudizhu";
		const done = () => {
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1600);
		};
		if (navigator.clipboard?.writeText) navigator.clipboard.writeText(cmd).then(done).catch(done);
		else done();
	};
	const enterOnline = async () => {
		try {
			const h = await health();
			if (h.protocol !== 1) {
				setVersionError({
					clientProtocol: 1,
					serverProtocol: h.protocol,
					serverVersion: h.version
				});
				return;
			}
			await auth(profile.uid);
			const me = await getMe();
			setOnline(true);
			setBalance(me.player.balance);
			setProfile((p) => ({
				...p,
				nickname: me.player.nickname,
				avatarId: me.player.avatarId
			}));
		} catch (e) {
			setNotice(e instanceof Error ? e.message : "在线连接失败");
		}
	};
	const leaveOnline = () => {
		setOnline(false);
		if (matching) cancelMatch();
		setBalance(loadBalance());
	};
	const claim = async () => {
		if (claimed) return;
		if (online) {
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
				} else setNotice(e instanceof Error ? e.message : "签到失败");
			}
			return;
		}
		const next = balance + CONFIG.dailyTokens;
		setBalance(next);
		saveBalance(next);
		localStorage.setItem("ddz:claim", todayKey());
		setClaimed(true);
		setNotice(`每日签到 +${CONFIG.dailyTokens.toLocaleString()}`);
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
	const startLocal = (tid) => {
		setTableId(tid);
		setResult(null);
		setScreen("table");
	};
	const startOnline = async (tid) => {
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
	const onFinishedLocal = (0, react.useCallback)((deltas, multiplier, winner, spring, _landlord, rake) => {
		setResult({
			myDelta: deltas[HUMAN_SEAT],
			multiplier,
			winner,
			spring,
			rake
		});
		const next = Math.max(0, balance + deltas[HUMAN_SEAT]);
		setBalance(next);
		saveBalance(next);
		setScreen("settle");
	}, [balance]);
	const onSettledOnline = (0, react.useCallback)((myDelta, balanceAfter, winner, spring, multiplier, rake) => {
		setResult({
			myDelta,
			multiplier,
			winner,
			spring,
			rake
		});
		setBalance(balanceAfter);
		setScreen("settle");
	}, []);
	const exitTable = () => {
		setRoomId(null);
		setScreen("lobby");
	};
	return (0, react.createElement)("div", { className: "ddz-root" }, (0, react.createElement)("style", null, STYLE), notice && (0, react.createElement)("div", {
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
	}, "我知道了")))), (0, react.createElement)("button", {
		className: "ddz-float",
		onClick: () => setOpen((v) => !v)
	}, (0, react.createElement)("span", { className: "ddz-float-title" }, "🃏 斗地主"), (0, react.createElement)("span", { className: "ddz-float-subtitle" }, online ? "在线对战" : "等待中，来一把")), open && (0, react.createElement)("div", {
		className: "ddz-overlay",
		onClick: (e) => {
			if (e.target === e.currentTarget) setOpen(false);
		}
	}, (0, react.createElement)("div", { className: "ddz-modal" }, (0, react.createElement)("button", {
		className: "ddz-corner-close",
		"aria-label": "关闭斗地主",
		onClick: () => setOpen(false)
	}, "×"), screen === "lobby" && (0, react.createElement)(Lobby, {
		profile,
		balance,
		claimed,
		online,
		matching,
		matchCount,
		rescued,
		lobbyLatency: lobbyLatencyMs,
		onClaim: claim,
		onRescue: rescue$1,
		onModeChange: (nextOnline) => {
			if (nextOnline === online) return;
			if (nextOnline) enterOnline();
			else leaveOnline();
		},
		onStartLocal: startLocal,
		onStartOnline: startOnline,
		onCancelMatch: cancelMatch,
		onProfileChange: updateProfile$1,
		onClose: () => setOpen(false)
	}), screen === "table" && (online && roomId ? (0, react.createElement)(OnlineTable, {
		roomId,
		tableId,
		profile,
		onExit: exitTable,
		onSettled: onSettledOnline
	}) : (0, react.createElement)(LocalTable, {
		tableId,
		base: tableById(tableId)?.base ?? 0,
		profile,
		balance,
		onExit: exitTable,
		onFinished: onFinishedLocal
	})), screen === "settle" && result && (0, react.createElement)(Settle, {
		result,
		balance,
		onExit: () => setScreen("lobby")
	}))));
}
//#endregion
//#region src/client/index.tsx
/**
* dsh-doudizhu 客户端入口
* 通过 body portal 挂载一个「斗地主」浮动入口 + 全局面板（ADR-007：不依赖 shell 槽位，
* 采用与 dsh-better-sidebar 相同的 document.body + createRoot 挂载方式）。
*/
/** 客户端所需服务（M1 无需额外服务） */
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