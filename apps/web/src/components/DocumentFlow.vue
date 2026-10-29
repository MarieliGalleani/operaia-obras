<script setup lang="ts">
const steps = [
  { icon: 'mdi-email-outline', title: 'Recebimento', text: 'E-mail, XML, PDF ou upload' },
  { icon: 'mdi-file-document-outline', title: 'Leitura', text: 'Extrai os dados da nota' },
  { icon: 'mdi-check-decagram-outline', title: 'Validação', text: 'Confere duplicidades e inconsistências' },
  { icon: 'mdi-hard-hat', title: 'Vínculo', text: 'Associa à obra, categoria e orçamento' },
  { icon: 'mdi-database-check-outline', title: 'Registro', text: 'Lança títulos e atualiza relatórios' },
]
</script>

<template>
  <div class="flow">
    <template v-for="(s, i) in steps" :key="s.title">
      <div class="step">
        <v-avatar color="primary" variant="tonal" rounded="lg" size="44"><v-icon>{{ s.icon }}</v-icon></v-avatar>
        <div>
          <div class="text-body-2 font-weight-bold">{{ i + 1 }}. {{ s.title }}</div>
          <div class="text-caption muted">{{ s.text }}</div>
        </div>
      </div>
      <v-icon v-if="i < steps.length - 1" class="arrow" color="#B9C3BF">mdi-arrow-right</v-icon>
    </template>
  </div>
</template>

<style scoped>
.flow {
  display: flex;
  align-items: center;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.step {
  display: flex;
  gap: 10px;
  align-items: center;
  min-width: 170px;
  flex: 1;
}
.arrow {
  flex-shrink: 0;
}
</style>
