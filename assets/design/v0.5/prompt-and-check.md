# v0.5 扩展牌原创插画

> 历史材料：本文件保留当时的设计、计划或验收，不作为当前行为说明。当前规则、UI、交付和待办见 [v0.9.5 当前状态](../../../docs/00-当前状态与文档索引.md)。

使用 GPT 内置 image_gen，未使用 Canva 或单独计费 CLI/API。参考现有原创 core-cards-overview.png 的柔和猫咪插画风格；不复制官方游戏角色、牌面或文字。

最终源图：expansion-art-atlas.png，1536×1024；3列×2行，每格512×512。顺序：内爆猫、定向攻击、反转；抽牌底、调整未来、野猫。运行资源为web/expansion.jpg、miniprogram/assets/expansion.jpg，JPEG质量78。名称、数字、规则和状态均由组件渲染。

检查：六格位置正确、猫咪及主道具独立、无文字与水印、柔和浅色符合原风格；小牌裁切在浏览器手机宽度目视检查。源图的野猫是带叶饰的原创橘猫，图案不作为规则事实，真实文字明确仅替代普通猫。

## 最终提示词

Use case: illustration-story. Create ONE game illustration sprite atlas for a cute friends-only card game, matching the softly shaded fluffy kitten illustration style of the supplied reference, but all original new compositions. Asset is NOT a UI mockup. A clean landscape image with an exact uniform 3-column by 2-row grid, 6 equal square illustration cells. No gutters, no text, no letters, no numbers, no titles, no border, no watermark. Each kitten and props fully contained well inside its own cell with 12% blank pastel margins, no crossing cells. Row1 left: white charcoal kitten beside a swirling dark violet implosion vortex with a small lavender star, friendly but clear danger theme, lavender background. Row1 middle: orange kitten pointing a paw toward a cute red-and-white concentric target while sending TWO coral card backs toward the target, pale peach background. Row1 right: cream kitten chasing a teal circular U-turn arrow bending to the left, mint background. Row2 left: gray kitten reaching UNDER a neat stack of coral cards and pulling the bottom card downward with a blue downward arrow, pale blue background. Row2 middle: gray-white kitten rearranging three upright pastel colored cards using two crossing violet arrows, pale lilac background. Row2 right: playful ginger tabby with a small leafy mane and a star charm, with two matching kitten cards beside it, warm pale yellow background. Style: original cuddly expressive kittens, soft fur, rounded shapes, subtle painted details, Apple-inspired calm composition. Reference image style only; do not copy reference text or existing artwork compositions. Intended atlas 1536x1024 or same 3:2 ratio.
