# 简单的发布/订阅系统，用于未来插件钩子
class EventBus:
    def __init__(self):
        self._subscribers = {}

    def subscribe(self, event_name, callback):
        # ... logic to add callback ...
        pass

    def emit(self, event_name, data=None):
        # ... logic to call callbacks ...
        pass

# 全局单例
event_bus = EventBus()