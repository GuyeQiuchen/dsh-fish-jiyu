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
