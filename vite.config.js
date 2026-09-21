import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  server: {
    port: 5173,
    open: true,
    // 开发期把 /api 转发到本地后端，前端用相对路径请求即可，避免跨域与硬编码域名。
    // 后端端口通过 PORT 调整时，这里也要同步改。
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
    watch: {
      // 前端不引用 server/ 下的任何文件，让它监听这些目录只有坏处：
      // 后端目录一旦有文件写入，监听器会去 watch 写入过程中的临时文件，
      // 在 Windows 上会因文件被占用抛出 EBUSY 并直接让 dev server 崩溃。
      // 同理也排除编辑器/工具写入时产生的 .tmpdir 目录。
      ignored: ['**/server/**', '**/dist/**', '**/.npm-cache/**', '**/*.tmpdir/**'],
    },
  },
})
