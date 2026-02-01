"""
ST Sync API - SillyTavern 资源同步接口

提供从 SillyTavern 读取和同步资源的 REST API

@module st_sync
@version 1.0.0
"""

import os
import logging
from flask import Blueprint, request, jsonify
from core.config import load_config, BASE_DIR
from core.services.st_client import get_st_client, refresh_st_client

logger = logging.getLogger(__name__)

bp = Blueprint('st_sync', __name__, url_prefix='/api/st')


@bp.route('/test_connection', methods=['GET'])
def test_connection():
    """
    测试与 SillyTavern 的连接
    
    Returns:
        连接状态信息
    """
    try:
        client = get_st_client()
        result = client.test_connection()
        return jsonify({
            "success": True,
            **result
        })
    except Exception as e:
        logger.error(f"测试连接失败: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@bp.route('/detect_path', methods=['GET'])
def detect_path():
    """
    自动探测 SillyTavern 安装路径
    
    Returns:
        探测到的路径信息
    """
    try:
        client = get_st_client()
        detected = client.detect_st_path()
        
        if detected:
            return jsonify({
                "success": True,
                "path": detected,
                "valid": True
            })
        else:
            return jsonify({
                "success": True,
                "path": None,
                "valid": False,
                "message": "未能自动探测到 SillyTavern 安装路径，请手动配置"
            })
    except Exception as e:
        logger.error(f"探测路径失败: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@bp.route('/validate_path', methods=['POST'])
def validate_path():
    """
    验证指定路径是否为有效的 SillyTavern 安装目录
    
    Body:
        path: 要验证的路径
        
    Returns:
        验证结果
    """
    try:
        data = request.get_json() or {}
        path = data.get('path', '')
        
        if not path:
            return jsonify({
                "success": False,
                "error": "请提供路径"
            }), 400
            
        client = get_st_client()
        is_valid = client._validate_st_path(path)
        
        resources = {}
        if is_valid:
            # 检查各资源目录
            from core.services.st_client import ST_DATA_STRUCTURE
            for res_type, subdir in ST_DATA_STRUCTURE.items():
                if res_type == "settings":
                    continue
                full_path = os.path.join(path, subdir)
                if os.path.exists(full_path):
                    try:
                        count = len([f for f in os.listdir(full_path) 
                                   if f.endswith('.json') or f.endswith('.png')])
                        resources[res_type] = {
                            "path": full_path,
                            "count": count
                        }
                    except:
                        resources[res_type] = {"path": full_path, "count": 0}
        
        return jsonify({
            "success": True,
            "valid": is_valid,
            "resources": resources
        })
    except Exception as e:
        logger.error(f"验证路径失败: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@bp.route('/list/<resource_type>', methods=['GET'])
def list_resources(resource_type: str):
    """
    列出指定类型的 SillyTavern 资源
    
    Args:
        resource_type: 资源类型 (characters/worlds/presets/regex/quick_replies)
        
    Query Params:
        use_api: 是否使用 API 模式 (默认 false)
        
    Returns:
        资源列表
    """
    try:
        use_api = request.args.get('use_api', 'false').lower() == 'true'
        client = get_st_client()
        
        if resource_type == 'characters':
            items = client.list_characters(use_api)
        elif resource_type == 'worlds':
            items = client.list_world_books(use_api)
        elif resource_type == 'presets':
            items = client.list_presets(use_api)
        elif resource_type == 'regex':
            items = client.list_regex_scripts(use_api)
        elif resource_type == 'quick_replies':
            items = client.list_quick_replies(use_api)
        else:
            return jsonify({
                "success": False,
                "error": f"未知资源类型: {resource_type}"
            }), 400
            
        return jsonify({
            "success": True,
            "resource_type": resource_type,
            "items": items,
            "count": len(items)
        })
    except Exception as e:
        logger.error(f"列出资源失败: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@bp.route('/get/<resource_type>/<resource_id>', methods=['GET'])
def get_resource(resource_type: str, resource_id: str):
    """
    获取单个资源详情
    
    Args:
        resource_type: 资源类型
        resource_id: 资源 ID
        
    Query Params:
        use_api: 是否使用 API 模式
        
    Returns:
        资源详情
    """
    try:
        use_api = request.args.get('use_api', 'false').lower() == 'true'
        client = get_st_client()
        
        if resource_type == 'characters':
            item = client.get_character(resource_id, use_api)
        elif resource_type == 'worlds':
            # 世界书需要完整读取
            items = client.list_world_books(use_api)
            item = next((w for w in items if w.get('id') == resource_id), None)
            if item and item.get('filepath'):
                item['data'] = client._read_world_book_file(item['filepath'])
        else:
            return jsonify({
                "success": False,
                "error": f"不支持获取详情的资源类型: {resource_type}"
            }), 400
            
        if item:
            return jsonify({
                "success": True,
                "item": item
            })
        else:
            return jsonify({
                "success": False,
                "error": f"未找到资源: {resource_id}"
            }), 404
    except Exception as e:
        logger.error(f"获取资源失败: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@bp.route('/sync', methods=['POST'])
def sync_resources():
    """
    同步资源到本地
    
    Body:
        resource_type: 资源类型
        resource_ids: 资源 ID 列表（可选，为空则同步全部）
        use_api: 是否使用 API 模式
        
    Returns:
        同步结果
    """
    try:
        data = request.get_json() or {}
        resource_type = data.get('resource_type')
        resource_ids = data.get('resource_ids', [])
        use_api = data.get('use_api', False)
        
        if not resource_type:
            return jsonify({
                "success": False,
                "error": "请指定资源类型"
            }), 400
            
        # 获取目标目录
        config = load_config()
        target_dir_map = {
            "characters": config.get('cards_dir', 'data/library/characters'),
            "worlds": config.get('world_info_dir', 'data/library/lorebooks'),
            "presets": config.get('presets_dir', 'data/library/presets'),
            "regex": config.get('regex_dir', 'data/library/extensions/regex'),
            "quick_replies": config.get('quick_replies_dir', 'data/library/extensions/quick-replies'),
        }
        
        target_dir = target_dir_map.get(resource_type)
        if not target_dir:
            return jsonify({
                "success": False,
                "error": f"未知资源类型: {resource_type}"
            }), 400
            
        # 处理相对路径
        if not os.path.isabs(target_dir):
            target_dir = os.path.join(BASE_DIR, target_dir)
            
        client = get_st_client()
        
        if resource_ids:
            # 同步指定资源
            result = {
                "success": 0,
                "failed": 0,
                "skipped": 0,
                "errors": [],
                "synced": []
            }
            for res_id in resource_ids:
                success, msg = client.sync_resource(resource_type, res_id, target_dir, use_api)
                if success:
                    result["success"] += 1
                    result["synced"].append(res_id)
                else:
                    result["failed"] += 1
                    result["errors"].append(f"{res_id}: {msg}")
        else:
            # 同步全部
            result = client.sync_all_resources(resource_type, target_dir, use_api)
            
        return jsonify({
            "success": True,
            "resource_type": resource_type,
            "target_dir": target_dir,
            "result": result
        })
    except Exception as e:
        logger.error(f"同步资源失败: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@bp.route('/refresh', methods=['POST'])
def refresh_client():
    """
    刷新 ST 客户端配置
    
    用于配置变更后重新初始化客户端
    """
    try:
        refresh_st_client()
        return jsonify({
            "success": True,
            "message": "客户端已刷新"
        })
    except Exception as e:
        logger.error(f"刷新客户端失败: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@bp.route('/summary', methods=['GET'])
def get_summary():
    """
    获取 SillyTavern 资源概览
    
    Returns:
        各类资源的数量统计
    """
    try:
        client = get_st_client()
        
        summary = {
            "st_path": client.st_data_dir or client.detect_st_path(),
            "resources": {}
        }
        
        # 统计各类资源
        resource_types = ['characters', 'worlds', 'presets', 'regex', 'quick_replies']
        for res_type in resource_types:
            try:
                if res_type == 'characters':
                    items = client.list_characters()
                elif res_type == 'worlds':
                    items = client.list_world_books()
                elif res_type == 'presets':
                    items = client.list_presets()
                elif res_type == 'regex':
                    items = client.list_regex_scripts()
                elif res_type == 'quick_replies':
                    items = client.list_quick_replies()
                else:
                    items = []
                    
                summary["resources"][res_type] = {
                    "count": len(items),
                    "available": True
                }
            except Exception as e:
                summary["resources"][res_type] = {
                    "count": 0,
                    "available": False,
                    "error": str(e)
                }
                
        return jsonify({
            "success": True,
            **summary
        })
    except Exception as e:
        logger.error(f"获取概览失败: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500
