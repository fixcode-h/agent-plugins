/**
 * 设置 →「组件」里 UMG 布局示例用的一小份控件配置（AssetForge 的 umg-widget 格式）：侧栏导航、横幅、三张数值卡，
 * 加两段动画（关键帧对象写法和 [t, v, interp] 简写都有）。截图验证也用它
 */
export const UMG_SAMPLE = JSON.stringify({
  kind: 'umg-widget',
  asset: '/Game/UI/WBP_Sample',
  root: {
    class: 'Overlay',
    name: 'Root',
    children: [
      {
        class: 'Border',
        name: 'Bg',
        props: { BrushColor: { R: 0.006, G: 0.008, B: 0.014, A: 1 } },
        slot: { HorizontalAlignment: 'HAlign_Fill', VerticalAlignment: 'VAlign_Fill' },
      },
      {
        class: 'HorizontalBox',
        name: 'Shell',
        slot: { HorizontalAlignment: 'HAlign_Fill', VerticalAlignment: 'VAlign_Fill' },
        children: [
          {
            class: 'SizeBox',
            name: 'SideWidth',
            props: { bOverride_WidthOverride: true, WidthOverride: 260 },
            children: [
              {
                class: 'Border',
                name: 'SideBg',
                props: {
                  BrushColor: { R: 0.01, G: 0.013, B: 0.024, A: 1 },
                  Padding: { Left: 18, Top: 24, Right: 18, Bottom: 24 },
                },
                children: [
                  {
                    class: 'VerticalBox',
                    name: 'SideCol',
                    children: [
                      {
                        class: 'TextBlock',
                        name: 'Brand',
                        props: { Text: 'Forge Sample', Font: { Size: 22, TypefaceFontName: 'Bold' } },
                        slot: { Padding: { Left: 0, Top: 0, Right: 0, Bottom: 28 } },
                      },
                      ...['首页', '背包', '商店', '任务', '设置'].map((label, i) => ({
                        class: 'Button',
                        name: `Go_Page_${i}`,
                        isVariable: true,
                        props: {
                          BackgroundColor:
                            i === 0 ? { R: 0.05, G: 0.2, B: 0.8, A: 1 } : { R: 0.03, G: 0.04, B: 0.07, A: 1 },
                          Padding: { Left: 14, Top: 10, Right: 14, Bottom: 10 },
                        },
                        slot: { Padding: { Left: 0, Top: 0, Right: 0, Bottom: 8 } },
                        children: [
                          {
                            class: 'TextBlock',
                            name: `Go_Page_${i}_Text`,
                            props: { Text: label, Font: { Size: 18 } },
                            slot: { HorizontalAlignment: 'HAlign_Left' },
                          },
                        ],
                      })),
                      { class: 'Spacer', name: 'SideFill', slot: { Size: { SizeRule: 'Fill', Value: 1 } } },
                      {
                        class: 'TextBlock',
                        name: 'Version',
                        props: {
                          Text: 'v0.1 · GameTest',
                          Font: { Size: 14 },
                          ColorAndOpacity: { SpecifiedColor: { R: 0.3, G: 0.33, B: 0.4, A: 1 } },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            class: 'VerticalBox',
            name: 'Main',
            slot: { Size: { SizeRule: 'Fill', Value: 1 }, Padding: { Left: 36, Top: 32, Right: 36, Bottom: 32 } },
            children: [
              {
                class: 'Border',
                name: 'Hero',
                props: {
                  Background: {
                    DrawAs: 'RoundedBox',
                    TintColor: { SpecifiedColor: { R: 0.12, G: 0.05, B: 0.45, A: 1 } },
                    OutlineSettings: { CornerRadii: { X: 16, Y: 16, Z: 16, W: 16 } },
                  },
                  Padding: { Left: 36, Top: 36, Right: 36, Bottom: 36 },
                },
                slot: { Padding: { Left: 0, Top: 0, Right: 0, Bottom: 24 } },
                children: [
                  {
                    class: 'VerticalBox',
                    name: 'HeroText',
                    children: [
                      {
                        class: 'TextBlock',
                        name: 'Welcome',
                        props: { Text: '欢迎回来，指挥官', Font: { Size: 40, TypefaceFontName: 'Bold' } },
                      },
                      {
                        class: 'TextBlock',
                        name: 'HeroSub',
                        props: {
                          Text: '今日任务已刷新，完成 3 个日常领取额外奖励',
                          Font: { Size: 18 },
                          ColorAndOpacity: { SpecifiedColor: { R: 0.7, G: 0.72, B: 0.85, A: 1 } },
                        },
                        slot: { Padding: { Left: 0, Top: 10, Right: 0, Bottom: 24 } },
                      },
                      {
                        class: 'Button',
                        name: 'Claim',
                        isVariable: true,
                        props: {
                          BackgroundColor: { R: 1, G: 0.55, B: 0.05, A: 1 },
                          Padding: { Left: 20, Top: 10, Right: 20, Bottom: 10 },
                        },
                        slot: { HorizontalAlignment: 'HAlign_Left' },
                        children: [
                          {
                            class: 'TextBlock',
                            name: 'ClaimText',
                            props: {
                              Text: '领取每日奖励',
                              Font: { Size: 18, TypefaceFontName: 'Bold' },
                              ColorAndOpacity: { SpecifiedColor: { R: 0.05, G: 0.03, B: 0, A: 1 } },
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                class: 'HorizontalBox',
                name: 'Stats',
                slot: { Padding: { Left: 0, Top: 0, Right: 0, Bottom: 24 } },
                children: [
                  ['金币', '12,800'],
                  ['等级', 'Lv. 42'],
                  ['体力', '96 / 120'],
                ].map(([label, value], i) => ({
                  class: 'Border',
                  name: `Stat_${i}`,
                  props: {
                    Background: {
                      DrawAs: 'RoundedBox',
                      TintColor: { R: 0.025, G: 0.03, B: 0.06, A: 1 },
                      OutlineSettings: { CornerRadii: { X: 12 } },
                    },
                    Padding: { Left: 22, Top: 18, Right: 22, Bottom: 18 },
                  },
                  slot: {
                    Size: { SizeRule: 'Fill', Value: 1 },
                    Padding: { Left: i ? 12 : 0, Top: 0, Right: 0, Bottom: 0 },
                  },
                  children: [
                    {
                      class: 'VerticalBox',
                      name: `Stat_${i}_Col`,
                      children: [
                        {
                          class: 'TextBlock',
                          name: `Stat_${i}_Label`,
                          props: {
                            Text: label,
                            Font: { Size: 14 },
                            ColorAndOpacity: { SpecifiedColor: { R: 0.4, G: 0.42, B: 0.5, A: 1 } },
                          },
                        },
                        {
                          class: 'TextBlock',
                          name: `Stat_${i}_Value`,
                          props: {
                            Text: value,
                            Font: { Size: 30, TypefaceFontName: 'Bold' },
                            ColorAndOpacity: {
                              SpecifiedColor: { R: 1, G: i === 0 ? 0.7 : 1, B: i === 0 ? 0.1 : 1, A: 1 },
                            },
                          },
                        },
                      ],
                    },
                  ],
                })),
              },
              {
                class: 'Border',
                name: 'Notice',
                props: {
                  Background: {
                    DrawAs: 'RoundedBox',
                    TintColor: { R: 0.025, G: 0.03, B: 0.06, A: 1 },
                    OutlineSettings: { CornerRadii: { X: 12 } },
                  },
                  Padding: { Left: 22, Top: 18, Right: 22, Bottom: 18 },
                },
                slot: { Size: { SizeRule: 'Fill', Value: 1 } },
                children: [
                  {
                    class: 'VerticalBox',
                    name: 'NoticeCol',
                    children: [
                      {
                        class: 'TextBlock',
                        name: 'NoticeTitle',
                        props: { Text: '公告', Font: { Size: 18, TypefaceFontName: 'Bold' } },
                        slot: { Padding: { Left: 0, Top: 0, Right: 0, Bottom: 12 } },
                      },
                      ...['周末双倍掉落开启', '新增「列表」页，练习录制列表条目', '周三 06:00 例行维护'].map(
                        (text, i) => ({
                          class: 'TextBlock',
                          name: `Notice_${i}`,
                          props: {
                            Text: text,
                            Font: { Size: 16 },
                            ColorAndOpacity: { SpecifiedColor: { R: 0.65, G: 0.67, B: 0.75, A: 1 } },
                          },
                          slot: { Padding: { Left: 0, Top: 0, Right: 0, Bottom: 8 } },
                        }),
                      ),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      { class: 'Border', name: 'Popup_Reward', props: { Visibility: 'Collapsed' } },
    ],
  },
  animations: [
    {
      name: 'Intro',
      tracks: [
        {
          target: 'Root/Shell/Main/Hero',
          channel: 'RenderOpacity',
          keys: [
            [0, 0],
            [0.3, 0.85, 'cubic'],
            [0.5, 1],
          ],
        },
        {
          target: 'Root/Shell/Main/Hero',
          channel: 'RenderTransform.Translation.X',
          keys: [
            { time: 0, value: 80, interp: 'linear' },
            { time: 0.5, value: 0 },
          ],
        },
        {
          target: 'Root/Shell/SideWidth',
          channel: 'RenderTransform.Translation.X',
          keys: [
            [0, -260, 'cubic'],
            [0.35, 0],
          ],
        },
        {
          target: 'Root/Shell/Main/Stats',
          channel: 'RenderOpacity',
          keys: [
            [0.2, 0],
            [0.6, 1],
          ],
        },
        {
          target: 'Root/Shell/Main/Stats',
          channel: 'slot.Padding.Top',
          keys: [
            [0.2, 40, 'linear'],
            [0.6, 0],
          ],
        },
      ],
    },
    {
      name: 'NavHover',
      tracks: [
        {
          target: 'Root/Shell/SideWidth/SideBg/SideCol/Go_Page_2',
          channel: 'RenderTransform.Scale.X',
          keys: [
            [0, 1, 'linear'],
            [0.15, 1.05],
          ],
        },
        {
          target: 'Root/Shell/SideWidth/SideBg/SideCol/Go_Page_2',
          channel: 'RenderTransform.Scale.Y',
          keys: [
            [0, 1, 'constant'],
            [0.15, 1.05],
          ],
        },
      ],
    },
  ],
})
