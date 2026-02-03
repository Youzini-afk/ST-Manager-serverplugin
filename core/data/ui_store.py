import os
import json
import logging
from core.config import DB_FOLDER
from core.consts import RESERVED_RESOURCE_NAMES

# 定义存储文件路径
UI_DATA_FILE = os.path.join(DB_FOLDER, 'ui_data.json')

logger = logging.getLogger(__name__)

def load_ui_data():
    """
    加载 UI 辅助数据 (JSON 格式)。
    包含用户的卡片备注、来源链接、资源文件夹映射等信息。
    
    Returns:
        dict: UI 数据字典。如果文件不存在或解析失败，返回空字典。
    """
    if os.path.exists(UI_DATA_FILE):
        try:
            with open(UI_DATA_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
            # === 脏数据清理逻辑 ===
            # 检查 resource_folder 是否使用了系统保留名称 (如 'cards', 'thumbnails' 等)
            dirty = False
            for key, info in data.items():
                rf = info.get('resource_folder', '')
                if rf:
                    # 兼容 Windows/Linux 分隔符，取第一层目录名检查
                    first_part = rf.replace('\\', '/').split('/')[0].lower()
                    if first_part in RESERVED_RESOURCE_NAMES:
                        logger.warning(f"检测到非法资源目录配置 '{rf}' (属于保留目录)，已自动移除关联。")
                        info['resource_folder'] = ""
                        dirty = True
            
            if dirty:
                # 如果有清理操作，立即回写文件以修正
                save_ui_data(data)
                
            return data
        except Exception as e:
            logger.error(f"加载 ui_data.json 失败: {e}")
            return {}
    return {}

def save_ui_data(data):
    """
    保存 UI 辅助数据到 JSON 文件。
    
    Args:
        data (dict): 要保存的数据字典。
    """
    try:
        # 确保父目录存在
        parent_dir = os.path.dirname(UI_DATA_FILE)
        if not os.path.exists(parent_dir):
            os.makedirs(parent_dir)
            
        with open(UI_DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f"保存 ui_data.json 失败: {e}")
        return False