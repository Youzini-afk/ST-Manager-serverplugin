import logging
from core.services.card_service import move_card_internal, modify_card_attributes_internal

logger = logging.getLogger(__name__)

class AutomationExecutor:
    def apply_plan(self, card_id, plan):
        """
        执行计划
        plan 结构: { 'move': 'Target/Path' or None, 'add_tags': set(), 'remove_tags': set(), 'favorite': bool/None }
        返回: 执行结果摘要
        """
        result = {
            "moved_to": None,
            "tags_added": [],
            "tags_removed": [],
            "fav_changed": False
        }
        
        current_id = card_id
        
        # 1. 执行属性修改 (标签、收藏)
        # 这些操作不改变 ID，先执行
        add_tags = list(plan.get('add_tags', []))
        remove_tags = list(plan.get('remove_tags', []))
        fav = plan.get('favorite')
        
        if add_tags or remove_tags or fav is not None:
            success = modify_card_attributes_internal(current_id, add_tags, remove_tags, fav)
            if success:
                result["tags_added"] = add_tags
                result["tags_removed"] = remove_tags
                if fav is not None: result["fav_changed"] = True

        # 2. 执行移动 (最后执行，因为会改变 ID)
        target_folder = plan.get('move')
        if target_folder is not None:
            # 如果目标是当前目录，跳过
            # 这需要调用者判断，或者 move_card_internal 会处理
            success, new_id, msg = move_card_internal(current_id, target_folder)
            if success:
                current_id = new_id
                result["moved_to"] = target_folder
            else:
                logger.warning(f"Automation move failed for {card_id}: {msg}")

        result["final_id"] = current_id
        return result