/**
 * static/js/components/presetDetailReader.js
 * 预设详情阅读器组件 - 独立的弹窗组件
 */
export default function presetDetailReader() {
    return {
        // 弹窗状态
        showModal: false,
        isLoading: false,
        
        // 当前预设数据
        activePresetDetail: null,
        
        // 内部标签状态
        sidebarTab: 'samplers',
        
        init() {
            // 监听打开事件
            window.addEventListener('open-preset-reader', (e) => {
                this.openPreset(e.detail);
            });
        },
        
        async openPreset(item) {
            this.isLoading = true;
            this.showModal = true;
            
            try {
                const resp = await fetch(`/api/presets/detail/${encodeURIComponent(item.id)}`);
                const res = await resp.json();
                
                if (res.success) {
                    this.activePresetDetail = res.preset;
                    this.sidebarTab = 'samplers';
                } else {
                    this.$store.global.showToast(res.msg || '获取详情失败', 'error');
                    this.closeModal();
                }
            } catch (e) {
                console.error('Failed to load preset:', e);
                this.$store.global.showToast('获取详情失败', 'error');
                this.closeModal();
            } finally {
                this.isLoading = false;
            }
        },
        
        closeModal() {
            this.showModal = false;
            this.activePresetDetail = null;
        },
        
        editRaw() {
            if (!this.activePresetDetail) return;
            // 触发编辑事件
            window.dispatchEvent(new CustomEvent('edit-preset-raw', {
                detail: this.activePresetDetail
            }));
        },
        
        openAdvancedExtensions() {
            if (!this.activePresetDetail) return;
            window.dispatchEvent(new CustomEvent('open-advanced-extensions', {
                detail: this.activePresetDetail
            }));
        },
        
        // 格式化参数值
        formatParam(value) {
            if (value === undefined || value === null) return '-';
            if (typeof value === 'number') return value.toString();
            return String(value);
        },
        
        // 标准化 prompts
        normalizePrompts(prompts) {
            if (!prompts || !Array.isArray(prompts)) return [];
            return prompts.map((p, idx) => ({
                ...p,
                key: p.key || `prompt-${idx}`,
                meta: p.meta || [],
                enabled: p.enabled !== false
            }));
        },
        
        // 获取 prompt 图标
        getPromptIcon(key) {
            const map = {
                'worldInfoBefore': '🌍', 'worldInfoAfter': '🌍',
                'charDescription': '👤', 'charPersonality': '🧠', 'personaDescription': '🎭',
                'scenario': '🏰',
                'chatHistory': '🕒', 'dialogueExamples': '💬',
                'main': '📜', 'jailbreak': '🔓'
            };
            return map[key] || '📌';
        },
        
        // 获取 prompt role
        getPromptRole(prompt) {
            const roleMeta = prompt.meta.find(m => m.startsWith('role:'));
            if (roleMeta) return roleMeta.split(':')[1].trim();
            return 'system';
        }
    };
}
