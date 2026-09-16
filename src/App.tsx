// 应用入口：案件披露材料审查模块（Disclosure Desk）
// 模块自包含于 src/disclosure，通过事件日志 + localStorage 持久化，本地运行无需后端
import Disclosure from './disclosure/Disclosure';
import { useReviewStore } from './disclosure/store';

export default function App() {
  const store = useReviewStore();
  return <Disclosure store={store} />;
}
