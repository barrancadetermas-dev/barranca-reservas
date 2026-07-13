// ══════════════════════════════════════════════════════════════
// guide-service.js — CRUD para la Guía del Huésped
// ══════════════════════════════════════════════════════════════

const DEFAULT_SECTIONS = [
  { key:'quickinfo',   title:'Info rápida',           icon:'⚡', sort_order:1 },
  { key:'howtoget',    title:'Cómo llegar',            icon:'📍', sort_order:2 },
  { key:'weather',     title:'Clima',                  icon:'🌤', sort_order:3 },
  { key:'visit',       title:'Qué visitar',            icon:'🎡', sort_order:4 },
  { key:'places',      title:'Dónde comer y comprar',  icon:'🍽', sort_order:5 },
  { key:'discounts',   title:'Descuentos',             icon:'🎁', sort_order:6 },
  { key:'rules',       title:'Reglas del complejo',    icon:'📜', sort_order:7 },
  { key:'emergencies', title:'Emergencias',            icon:'🚨', sort_order:8 },
  { key:'faq',         title:'Preguntas frecuentes',   icon:'❓', sort_order:9 },
  { key:'contact',     title:'Contacto',               icon:'📞', sort_order:10 },
];

export class GuideService {
  constructor(supabase, ctx) {
    this.db  = supabase;
    this.ctx = ctx;
    this.hotelId = ctx.hotelId;
  }

  // ── Config ────────────────────────────────────────────
  async getConfig() {
    const { data } = await this.db.from('guide_config').select('*').eq('hotel_id', this.hotelId).single();
    return data;
  }
  async saveConfig(payload) {
    const existing = await this.getConfig();
    if (existing) {
      return this.db.from('guide_config').update({ ...payload, updated_at: new Date().toISOString() }).eq('hotel_id', this.hotelId);
    } else {
      return this.db.from('guide_config').insert({ ...payload, hotel_id: this.hotelId });
    }
  }

  // ── Sections ──────────────────────────────────────────
  async getSections() {
    const { data } = await this.db.from('guide_sections').select('*').eq('hotel_id', this.hotelId).order('sort_order');
    if (!data?.length) {
      // Insert default sections on first use
      await this.db.from('guide_sections').insert(DEFAULT_SECTIONS.map(s => ({ ...s, hotel_id: this.hotelId })));
      return DEFAULT_SECTIONS.map(s => ({ ...s, hotel_id: this.hotelId, is_visible: true }));
    }
    return data;
  }
  async updateSection(id, payload) {
    return this.db.from('guide_sections').update(payload).eq('id', id);
  }
  async reorderSections(orderedIds) {
    return Promise.all(orderedIds.map((id, i) => this.db.from('guide_sections').update({ sort_order: i }).eq('id', id)));
  }

  // ── Items ─────────────────────────────────────────────
  async getItems(sectionKey = null) {
    let q = this.db.from('guide_items').select('*').eq('hotel_id', this.hotelId).order('sort_order');
    if (sectionKey) q = q.eq('section_key', sectionKey);
    const { data } = await q;
    return data ?? [];
  }
  async saveItem(item) {
    if (item.id) {
      const { id, ...rest } = item;
      return this.db.from('guide_items').update(rest).eq('id', id);
    }
    return this.db.from('guide_items').insert({ ...item, hotel_id: this.hotelId });
  }
  async deleteItem(id) {
    return this.db.from('guide_items').delete().eq('id', id);
  }
  async reorderItems(sectionKey, orderedIds) {
    return Promise.all(orderedIds.map((id, i) => this.db.from('guide_items').update({ sort_order: i }).eq('id', id)));
  }

  // ── FAQs ─────────────────────────────────────────────
  async getFaqs() {
    const { data } = await this.db.from('guide_faqs').select('*').eq('hotel_id', this.hotelId).order('sort_order');
    return data ?? [];
  }
  async saveFaq(faq) {
    if (faq.id) {
      const { id, ...rest } = faq;
      return this.db.from('guide_faqs').update(rest).eq('id', id);
    }
    return this.db.from('guide_faqs').insert({ ...faq, hotel_id: this.hotelId });
  }
  async deleteFaq(id) {
    return this.db.from('guide_faqs').delete().eq('id', id);
  }

  // ── Image upload ──────────────────────────────────────
  async uploadImage(file, folder = 'guide') {
    const ext  = file.name.split('.').pop();
    const name = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { data, error } = await this.db.storage.from('guide-images').upload(name, file, { upsert: false });
    if (error) throw error;
    const { data: pub } = this.db.storage.from('guide-images').getPublicUrl(data.path);
    return pub.publicUrl;
  }

  // ── Analytics ─────────────────────────────────────────
  async getViewStats() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data } = await this.db.from('guide_views').select('section, viewed_at').eq('hotel_id', this.hotelId).gte('viewed_at', thirtyDaysAgo);
    const total = data?.length ?? 0;
    const bySection = {};
    data?.forEach(v => { bySection[v.section] = (bySection[v.section] || 0) + 1; });
    return { total, bySection };
  }
}
