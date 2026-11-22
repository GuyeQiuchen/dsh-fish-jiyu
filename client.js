/**
 * ⚠ 死代码，留着是历史，别照它改。
 *
 * 2026-11-20 那一版想把「压缩」这一格注册到会话视图标签栏和右侧栏，
 * 客户端模块始终没被加载，界面上从没出现过。后来退版退到删除之前，
 * 这个文件又回来了，但注册依然不生效——它跑不到，所以既不显示也不报错。
 *
 * 要真的重做，先读 DSH 的客户端模块加载逻辑（`dsh.client` 那段清单填的是
 * 模块名，不是服务名，填错就整块跳过、一行不执行、也不报错），再动手。
 *
 * 现在要看压缩情况：用 `jiyu_inspect` 工具，同一份数据。
 */
window.__ModuleLoader__.load({
  id: 'dsh-fish-jiyu',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const ROUTE = '/dsh-fish-jiyu/inspect.html'

    // 和 dsh-fish-arch 一模一样的位置：注册进 conversation.view，
    // 会话头部的视图标签栏会多出「压缩」这一格（跟「对话」并排的胶囊），
    // 点它把会话主体换成压缩决策页，点「对话」换回来。
    // 页面按会话取报告：切到别的会话，看到的就是那个会话自己的压缩。
    function JiyuInspectView(props) {
      // 每次挂载带一个新时间戳，免得浏览器把上一次的页面从缓存里翻出来。
      const session = String(props?.sessionId ?? '')
      const query = 't=' + Date.now() + (session === '' ? '' : '&session=' + encodeURIComponent(session))
      const src = ROUTE + '?' + query
      return h('div', {
        style: {
          position: 'relative',
          width: '100%',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
          background: '#07080d',
        },
      },
      h('iframe', {
        title: '压缩决策',
        src,
        style: {
          display: 'block',
          width: '100%',
          height: '100%',
          border: 0,
          background: '#07080d',
        },
      }))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view',
          id: 'jiyu-inspect',
          order: 21,
          label: '压缩',
        }, JiyuInspectView))
      },
    }
  },
})
