// Original practice illustrations. The same palette and framing are used on all tiles.
const frame = art => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><path fill="#e9e1d7" d="M0 0h160v160H0z"/><g stroke="#514b47" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${art}</g></svg>`
)}`
const pictures = [
  ['light', '光线', '光穿过窗户，在地板上投出一块亮斑。', `
    <path fill="#8f9eab" d="M38 21h56v67H38z"/><path fill="#ffe5a4" stroke="none" d="M43 28h46v54H43zM42 85h50l49 48H66z"/>
    <path fill="none" d="M66 23v62M40 52h51M29 89h74M21 133h122"/>`],
  ['light', '轻的', '同一架天平上，羽毛那一端翘得更高。', `
    <path fill="#a5ad99" d="M77 64h8v62H77zM52 126h59v8H52z"/><path d="m30 54 101 27M30 54 14 90h32zM131 81l-16 34h32z" fill="none"/>
    <path fill="#8f9eab" d="M12 89h36q-3 11-18 11T12 89zm101 25h36q-3 11-18 11t-18-11z"/>
    <path fill="#faf3e9" d="M22 87c-1-13 5-21 15-20 2 10-5 15-15 20z"/><path fill="#bf9d88" d="m122 114-4-11 13-8 11 7-1 12z"/>`],
  ['break', '打破', '杯身撞到地面后裂开，碎片散在旁边。', `
    <path fill="none" d="M18 129h125M50 31l6 14m17-24 5 17"/><path fill="#8f9eab" d="M49 62l51-14 1 36-16 3-8 15-14-5zM101 52q27-7 27 10t-25 19"/>
    <path fill="#8f9eab" d="m71 118 12-14 9 16zM98 118l4-17 10 11zM43 121l7-13 10 10z"/>`],
  ['break', '休息', '工作工具放在一旁，人坐下喝水歇一会儿。', `
    <path fill="#bf9d88" d="M15 97h130v11H15zM30 108v23m99-23v23"/><circle cx="72" cy="40" r="14" fill="#e2b89d"/>
    <path fill="#a5ad99" d="M61 56q-14 14-14 38h41l-5-33z"/><path fill="none" stroke-width="8" d="m74 69 18 7 14-19m-31 38 22 12-5 26"/>
    <path fill="#8f9eab" d="M97 44h17l-3 16h-11z"/><path fill="#c5a5a2" d="M115 90h21v7h-21z"/>`],
  ['draw', '画', '铅笔尖正在纸上描出图案。', `
    <path fill="#fbf6ec" d="M26 31h104v100H26z"/><path fill="none" stroke="#617667" d="m41 110 22-30 16 19 15-12 22 23z"/><circle cx="59" cy="60" r="8" fill="#f2d28f"/>
    <path fill="#bf9d88" d="m90 88 5-17 38-43 11 10-39 43z"/><path d="m90 88 5-17 10 10z" fill="#e9c6a5"/>`],
  ['draw', '拉', '手用力把打开一条缝的抽屉拉出来。', `
    <path fill="#a5ad99" d="M43 35h76v87H43z"/><path fill="#514b47" d="M48 48h65v29H48z"/>
    <path fill="#c5a5a2" d="m48 76 20-17h65l-19 17v27H48z"/><path fill="#e9e1d7" d="M72 86h24v6H72z"/>
    <path fill="#e2b89d" d="m12 109 30-19 27-6q13 1 7 10l-22 8-25 23z"/><path d="m29 76 11-6m-16-5 11-6" fill="none"/>`],
  ['absorb', '吸收', '海绵底部接触水洼，深色湿痕向海绵内部延伸。', `
    <path fill="#8f9eab" d="M24 108q-14-5 2-13 19-8 54-7 35-3 55 7 14 11-9 15z"/>
    <rect x="50" y="38" width="60" height="60" rx="7" fill="#efcc85"/>
    <path fill="#7f9381" d="M50 78q7 3 15-6t18 1q10 2 27-10v27q0 8-7 8H57q-7 0-7-8z"/>
    <path fill="none" d="M62 50h3m14 9h4m12-10h3m-37 15h2m31 19h4m-26 3h3"/>`],
  ['spill', '洒出', '杯子翻倒，水从杯口流到桌面。', `
    <path fill="#8f9eab" d="M83 82q12 3 19 13t29 10q20 12-6 18-40 4-48-12-6-10 6-29z"/>
    <path fill="#bf9d88" d="m37 53 50 26-12 20-52-16zM42 53q2-17 14-13t6 24"/>
    <path fill="none" d="M17 128h125M103 86l7 4m17 6 6 2"/>`],
  ['between', '在……之间', '红球位于两个相同盒子的中间。', `
    <path fill="#8f9eab" d="M19 49h35v67H19zM106 49h35v67h-35z"/>
    <path fill="#b9c3cc" d="m19 49 9-10h35l-9 10zm87 0 9-10h35l-9 10z"/>
    <path fill="#778895" d="M54 49l9-10v64l-9 13zm87 0 9-10v64l-9 13z"/>
    <circle cx="80" cy="103" r="13" fill="#be766d"/><path fill="none" d="M13 117h138"/>`],
  ['fragile', '易碎的', '薄玻璃杯轻碰木架边缘就裂开了。', `
    <path fill="#bf9d88" d="M94 91h49v16H94zM114 107h10v29h-10z"/>
    <path fill="#bdd1d8" d="m39 48 53 11-13 45-37-7z"/><ellipse cx="66" cy="54" rx="27" ry="7" transform="rotate(12 66 54)" fill="#e4eff1"/>
    <path fill="none" d="m84 86-11-1-5-12-9 7-3-13m17 18-7 13m31-21 7-6M35 63l-8-2"/>`],
  ['carefully', '小心地', '捧住满碗水，迈一小步跨过地上的线。', `
    <circle cx="72" cy="37" r="12" fill="#e2b89d"/><path fill="#a5ad99" d="m66 51-9 40 30 3-4-40z"/>
    <path fill="none" stroke-width="8" d="m64 91-10 23-13 10m39-32 19 12 7 13m-29-56 12 16 17-1"/>
    <path fill="#8f9eab" d="M95 67h37q-4 16-18 16t-19-16z"/><path fill="none" d="M20 129h119m-54-1q3-13 10-7t22-3"/>`],
  ['empty', '空的', '从正面能看见柜子里的每一层都没有东西。', `
    <path fill="#bf9d88" d="M34 27h92v106H34z"/><path fill="#fbf6ec" d="M43 36h74v86H43z"/>
    <path fill="#bf9d88" d="M43 75h74v8H43zM39 133v7m82-7v7"/>`],
  ['bridge', '桥', '两岸之间的拱桥跨过河面。', `
    <path fill="#8f9eab" stroke="none" d="M54 68h52l25 92H27z"/>
    <path fill="#bf9d88" d="M17 105q12-43 63-43t63 43h-22q-10-24-41-24t-41 24z"/>
    <path fill="none" d="M22 92q19-44 58-44t58 44M47 59v13m33-24v14m33-3v13m-48 58h30"/>`],
  ['pour', '倒入', '手握水壶，水流准确落入直立的杯子。', `
    <path fill="#a5ad99" d="M27 33l49 15-9 39-44-13zM29 36Q5 24 14 47l9 15M69 55l26 3-20 13z"/>
    <path fill="none" stroke="#647f92" stroke-width="5" d="M91 63q20 4 20 37"/>
    <path fill="#8f9eab" d="M92 100h37l-5 32H97z"/><path fill="none" d="M22 133h116"/>`],
  ['narrow', '狭窄的', '两面砖墙之间的通道只够一人侧身穿过。', `
    <path fill="#bf9d88" d="M11 29h43l13 19v69l-13 17H11zm138 0h-43L93 48v69l13 17h43z"/>
    <path fill="none" d="M12 55h46M12 82h52M12 109h51m40-54h46M96 82h53m-52 27h52"/>
    <circle cx="80" cy="67" r="9" fill="#e2b89d"/><path fill="#a5ad99" d="M75 78h10l5 25-19 4z"/><path d="m77 107-3 15m11-15 4 10"/>`],
  ['anchor', '锚', '船下方的锚用两侧弯钩抓住海底。', `
    <path fill="#8f9eab" stroke="none" d="M0 47h160v89H0z"/><path fill="#bf9d88" d="M48 25h67l-13 22H62z"/>
    <path fill="none" d="m82 47-1 19m-1 14v44M62 90h36M46 104q7 22 34 22t34-22m-68 0-2 13m2-13 13 3m55-3 2 13m-2-13-13 3" stroke-width="5"/>
    <circle cx="80" cy="73" r="7" fill="none"/><path fill="none" d="M16 136h128"/>`],
]

// Example keys identify account-owned replacements in the database. Append new entries without reordering.
export const IMAGE_RECALL_EXAMPLES = pictures.map(([spelling, sense, explanation, art], index) => ({
  key: `example-${index}`, spelling, sense, explanation, url: frame(art),
}))
