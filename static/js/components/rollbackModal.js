/**
 * static/js/components/rollbackModal.js
 * 时光机组件：版本回滚与差异对比
 */

import { 
    listBackups, 
    restoreBackup, 
    readFileContent, 
    normalizeCardData, 
    openPath 
} from '../api/system.js';

import { getCardMetadata } from '../api/card.js';
import { generateSideBySideDiff } from '../utils/diff.js';
import { getCleanedV3Data, toStV3Worldbook } from '../utils/data.js';

export default function rollbackModal() {
    return {
        // === 本地状态 ===
        showRollbackModal: false,
        isLoading: false,
        isDiffLoading: false,
        
        backupList: [],           // 历史备份列表
        rollbackVersions: [],     // 包含 Current 的完整列表
        
        // 目标信息
        rollbackTargetType: '',   // 'card' | 'lorebook'
        rollbackTargetId: '',
        rollbackTargetPath: '',
        rollbackLiveContent: null, // 当前编辑器中的实时内容
        
        // Diff 状态
        diffSelection: { left: null, right: null },
        diffData: { left: '', right: '', currentObj: null },

        init() {
            // 监听打开事件 (由 detailModal 或 wiEditor 触发)
            window.addEventListener('open-rollback', (e) => {
                const { type, id, path, editingData, editingWiFile } = e.detail;
                this.openRollback(type, id, path, editingData, editingWiFile);
            });
        },

        // === 打开时光机 ===
        openRollback(type, targetId, targetPath, editingData, editingWiFile) {
            this.rollbackTargetType = type;
            this.rollbackTargetId = targetId;
            this.rollbackTargetPath = targetPath;
            this.rollbackLiveContent = null;

            // 1. 捕获实时内容 (Live Content)
            if (type === 'card') {
                // 如果传入了 editingData 且 ID 匹配，说明正在编辑
                if (editingData && editingData.id === targetId) {
                    this.rollbackLiveContent = getCleanedV3Data(editingData);
                }
            } else if (type === 'lorebook') {
                // 如果正在编辑该世界书
                let isEditingThis = false;
                if (editingWiFile) {
                    if (editingWiFile.id === targetId) isEditingThis = true;
                }
                
                if (isEditingThis && editingData && editingData.character_book) {
                    const name = editingData.character_book.name || "World Info";
                    this.rollbackLiveContent = toStV3Worldbook(editingData.character_book, name);
                }
            }

            this.isLoading = true;
            listBackups({ id: targetId, type: type, file_path: targetPath })
                .then(res => {
                    this.isLoading = false;
                    if (res.success) {
                        // 构造版本列表
                        const currentVer = {
                            filename: "Current (当前编辑器版本)",
                            path: null, // null 表示需要读取 Live 或 Disk Current
                            mtime: new Date().getTime() / 1000,
                            size: 0,
                            is_current: true,
                            label: "LIVE"
                        };
                        
                        this.backupList = res.backups;
                        this.rollbackVersions = [currentVer, ...res.backups];
                        
                        // 默认选中：左=最近备份，右=当前
                        this.diffSelection = {
                            left: this.backupList.length > 0 ? this.backupList[0] : null,
                            right: currentVer
                        };
                        
                        this.showRollbackModal = true;
                        
                        // 立即加载 Diff
                        this.updateDiffView();
                    } else {
                        alert(res.msg);
                    }
                })
                .catch(err => {
                    this.isLoading = false;
                    alert("加载备份失败: " + err);
                });
        },

        // === Diff 逻辑 ===

        setDiffSide(side, version) {
            this.diffSelection[side] = version;
            this.updateDiffView();
        },

        updateDiffView() {
            const leftVer = this.diffSelection.left;
            const rightVer = this.diffSelection.right;

            if (!leftVer || !rightVer) {
                this.diffData = { left: '<div class="p-8 text-center text-gray-500">请在左侧列表选择版本进行比对</div>', right: '' };
                return;
            }

            this.isDiffLoading = true;

            // Helper: 加载单侧数据
            const loadData = async (ver) => {
                let data;
                
                // 场景 A: 当前版本 (Current)
                if (ver.is_current) {
                    let rawContent = this.rollbackLiveContent;
                    
                    // 如果没有实时内容，从 API 读取
                    if (!rawContent) {
                        if (this.rollbackTargetType === 'card') {
                            // 读取角色卡元数据
                            const res = await getCardMetadata(this.rollbackTargetId);
                            rawContent = (res.success === true && res.data) ? res.data : res;
                        } else if (this.rollbackTargetType === 'lorebook') {
                            // 读取世界书
                            if (this.rollbackTargetId.startsWith('embedded::')) {
                                // 内嵌：读取宿主卡片
                                const realId = this.rollbackTargetId.replace('embedded::', '');
                                const res = await getCardMetadata(realId);
                                rawContent = (res.success === true && res.data) ? res.data : res;
                            } else {
                                // 独立文件
                                const res = await readFileContent({ path: this.rollbackTargetPath });
                                rawContent = res.data;
                            }
                        }
                    }

                    // 后端清洗 (Normalize) - 确保格式与备份一致，便于 Diff
                    const cleanRes = await normalizeCardData(rawContent);
                    if (cleanRes.success) {
                        data = cleanRes.data;
                    } else {
                        console.warn("清洗失败，使用原始数据", cleanRes.msg);
                        data = rawContent;
                    }
                } 
                // 场景 B: 历史备份 (Backup)
                else {
                    const res = await readFileContent({ path: ver.path });
                    data = res.data;
                }

                // 特殊处理：如果是内嵌世界书，只提取 character_book 字段进行对比
                if (this.rollbackTargetType === 'lorebook' && this.rollbackTargetId.startsWith('embedded::')) {
                    if (data.data && data.data.character_book) {
                        data = data.data.character_book;
                    } else if (data.character_book) {
                        data = data.character_book;
                    }
                }

                return data;
            };

            // 并行加载并对比
            Promise.all([loadData(leftVer), loadData(rightVer)])
                .then(([leftData, rightData]) => {
                    const result = generateSideBySideDiff(leftData, rightData);
                    this.diffData.left = result.left;
                    this.diffData.right = result.right;
                })
                .catch(e => {
                    console.error(e);
                    this.diffData.left = `<div class="p-4 text-red-500">Error: ${e.message}</div>`;
                    this.diffData.right = '';
                })
                .finally(() => {
                    this.isDiffLoading = false;
                });
        },

        // === 恢复逻辑 ===

        performRestore() {
            const targetVer = this.diffSelection.left;
            
            if (!targetVer || targetVer.is_current) {
                alert("请在左侧选择一个历史备份版本进行恢复");
                return;
            }
            if (!confirm(`确定回滚到 ${new Date(targetVer.mtime*1000).toLocaleString()} 的版本吗？`)) return;
            
            this.isLoading = true;
            restoreBackup({
                backup_path: targetVer.path,
                target_id: this.rollbackTargetId,
                type: this.rollbackTargetType,
                target_file_path: this.rollbackTargetPath
            }).then(res => {
                this.isLoading = false;
                if(res.success) {
                    alert("回滚成功！页面将刷新数据。");
                    this.showRollbackModal = false;
                    
                    // 刷新父级数据
                    if (this.rollbackTargetType === 'card') {
                        // 通知详情页刷新
                        // 注意：这里需要 Card ID，如果是内嵌WI，ID需要处理
                        let refreshId = this.rollbackTargetId;
                        if (refreshId.startsWith('embedded::')) refreshId = refreshId.replace('embedded::', '');
                        
                        // 由于 detailModal 可能不在作用域内，通过事件通知
                        // detailModal 需要监听 'refresh-card-detail'
                        // 但在原 app.js 逻辑中，是直接调用 refreshActiveCardDetail
                        // 这里我们派发通用刷新事件
                        window.dispatchEvent(new CustomEvent('card-updated', { detail: { id: refreshId } })); // 触发重载
                        window.dispatchEvent(new CustomEvent('refresh-card-list'));
                    } 
                    else if (this.rollbackTargetType === 'lorebook') {
                        window.dispatchEvent(new CustomEvent('refresh-wi-list'));
                        // 如果在编辑器中，也应该刷新编辑器，这里简单处理为刷新列表
                    }
                } else {
                    alert("回滚失败: " + res.msg);
                }
            });
        },

        // 打开备份文件夹
        openBackupFolder() {
            const type = this.rollbackTargetType; // 'card' | 'lorebook'
            const id = this.rollbackTargetId;     // e.g. "group/name.png" or "embedded::group/name.png"
            const path = this.rollbackTargetPath; // e.g. "data/..." (only for standalone WI)

            // 1. 预判逻辑
            let isEmbedded = false;
            let targetName = "";

            // 辅助：从 ID 或路径中提取纯文件名 (无后缀)
            const extractName = (str) => {
                if (!str) return "";
                // 取文件名部分 -> 去后缀 -> 替换非法字符
                return str.split('/').pop().replace(/\.[^/.]+$/, "").replace(/[\\/:*?"<>|]/g, '_').trim();
            };

            if (type === 'lorebook') {
                if (id && id.startsWith('embedded::')) {
                    isEmbedded = true;
                    // embedded::card_id -> 提取 card_id 部分
                    const realCardId = id.replace('embedded::', '');
                    targetName = extractName(realCardId);
                } else {
                    // 独立世界书，使用文件路径提取名字
                    targetName = extractName(path);
                }
            } else {
                // 角色卡
                targetName = extractName(id);
            }

            // 2. 构造路径
            let base = "";
            if (isEmbedded || type === 'card') {
                base = `data/system/backups/cards`;
            } else {
                base = `data/system/backups/lorebooks`;
            }

            let specific = "";
            if (targetName) {
                specific = `${base}/${targetName}`;
            } else {
                specific = base;
            }

            // 3. 执行打开请求
            openPath({ 
                path: specific, 
                relative_to_base: true 
            }).then(res => {
                if(!res.success) {
                    // 如果特定目录不存在 (比如还没备份过)，尝试打开上一级基础目录
                    openPath({ path: base, relative_to_base: true });
                }
            });
        }
    }
}