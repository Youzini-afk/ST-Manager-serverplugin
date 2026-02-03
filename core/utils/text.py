import math
import re

# token计算
def calculate_token_count(card_data):
    """
    Python 版 Token 估算：
    中文 = 1, 其他 = 1/3.5
    """
    try:
        # 聚合文本
        text = ""
        text += (card_data.get('name') or '')
        text += (card_data.get('description') or '')
        text += (card_data.get('first_mes') or '')
        text += (card_data.get('mes_example') or '')
        
        # 处理世界书 (兼容 V2/V3)
        cb = card_data.get('character_book')
        entries = []
        if cb:
            if isinstance(cb, list): # V2 数组
                entries = cb
            elif isinstance(cb, dict) and 'entries' in cb: # V3 对象
                entries = cb['entries']
        
        for e in entries:
            # 默认启用，除非明确 disable
            if e.get('enabled', True):
                text += e.get('content', '')
                keys = e.get('keys', [])
                if isinstance(keys, list):
                    text += "".join(keys)
                else:
                    text += str(keys)
        
        if not text: return 0

        # 计算
        # 匹配 CJK (中日韩) 字符
        cjk_count = len(re.findall(r'[\u4e00-\u9fa5]', text))
        other_count = len(text) - cjk_count
        
        return math.ceil(cjk_count + (other_count / 3.5))
    except Exception as e:
        print(f"Token calc error: {e}")
        return 0