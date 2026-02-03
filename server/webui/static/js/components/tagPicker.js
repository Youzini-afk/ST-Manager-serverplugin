/**
 * static/js/components/tagPicker.js
 * 标签选择器组件 (用于详情页/编辑器)
 */

export default function tagPicker() {
    return {
        // === 本地状态 ===
        showTagPicker: false,
        tagPickerSearch: '',
        
        // 目标标签数组的引用 (通过事件传入)
        tagsRef: null, 

        init() {
            // 监听打开事件
            // detailModal 触发: window.dispatchEvent(new CustomEvent('open-tag-picker', { detail: editingData.tags }))
            window.addEventListener('open-tag-picker', (e) => {
                this.tagsRef = e.detail; // 接收数组引用
                this.tagPickerSearch = '';
                this.showTagPicker = true;
            });
        },

        // === 计算属性：过滤标签池 ===
        get filteredTagPickerPool() {
            // 使用全局 Store 中的全量标签池
            const pool = this.$store.global.globalTagsPool || [];
            if (!this.tagPickerSearch) return pool;
            return pool.filter(t => t.toLowerCase().includes(this.tagPickerSearch.toLowerCase()));
        },

        // === 操作逻辑 ===

        toggleEditTag(t) {
            if (!this.tagsRef) return;
            
            const i = this.tagsRef.indexOf(t);
            if (i > -1) {
                this.tagsRef.splice(i, 1);
            } else {
                this.tagsRef.push(t);
            }
        },

        addTag() {
            // 支持回车添加新标签
            const val = this.tagPickerSearch.trim();
            if (!val || !this.tagsRef) return;

            if (!this.tagsRef.includes(val)) {
                this.tagsRef.push(val);
            }
            this.tagPickerSearch = '';
        }
    }
}