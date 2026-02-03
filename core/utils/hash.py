import os
import hashlib
import json
import time
import logging
from core.utils.data import normalize_card_v3, deterministic_sort

logger = logging.getLogger(__name__)

def get_file_hash_and_size(file_path):
    """获取文件哈希和大小，用于检测文件变化"""
    try:
        st = os.stat(file_path)
        file_size = st.st_size

        # === 大文件使用采样哈希，避免全量读造成 CPU/IO 压力 ===
        # 采样策略：size + 头64KB + 尾64KB
        # 注意：这是“快速签名”，不是严格去重用的密码学 hash
        SAMPLE = 64 * 1024
        hasher = hashlib.md5()
        hasher.update(str(file_size).encode('utf-8'))

        with open(file_path, 'rb') as f:
            if file_size <= SAMPLE * 2:
                # 小文件：全量读
                for chunk in iter(lambda: f.read(8192), b''):
                    hasher.update(chunk)
            else:
                head = f.read(SAMPLE)
                hasher.update(head)
                f.seek(-SAMPLE, os.SEEK_END)
                tail = f.read(SAMPLE)
                hasher.update(tail)

        return hasher.hexdigest(), file_size
    except Exception as e:
        logger.error(f"Error calculating file hash: {e}")
        return "", 0

def _calculate_data_hash(data):
    """
    计算数据的 MD5 哈希。
    关键：必须先经过 deterministic_sort 排序，保证相同内容的 JSON 生成唯一的 Hash。
    """
    if not data: return ""
    try:
        # 1. 模拟写入时的标准化 (V3清洗)
        if 'name' in data or 'data' in data:
            data = normalize_card_v3(data)
        
        # 2. 确定性排序
        sorted_data = deterministic_sort(data)
        
        # 3. 生成紧凑的 JSON 字符串进行 Hash
        json_str = json.dumps(sorted_data, ensure_ascii=False, separators=(',', ':'))
        return hashlib.md5(json_str.encode('utf-8')).hexdigest()
    except Exception as e:
        print(f"Hash calculation error: {e}")
        return str(time.time()) # 降级处理