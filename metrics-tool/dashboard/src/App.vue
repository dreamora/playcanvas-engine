<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { db, ref as dbRef, onValue } from './firebase';
import { Line, Scatter } from 'vue-chartjs';
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  CategoryScale,
  TimeScale
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { format } from 'date-fns';

ChartJS.register(
  Title,
  Tooltip,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  CategoryScale,
  TimeScale
);

interface Metric {
  jiraId: string;
  prNumber: number;
  title: string;
  cycleTimeHours: number;
  prLeadTimeHours: number;
  prMergedAt: string;
}

const metrics = ref<Metric[]>([]);
const loading = ref(true);

onMounted(() => {
  if (!db) {
    loading.value = false;
    return;
  }
  const metricsRef = dbRef(db, 'metrics');
  onValue(metricsRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      const allMetrics: Metric[] = [];
      Object.keys(data).forEach(repo => {
        Object.keys(data[repo]).forEach(prNum => {
          allMetrics.push(data[repo][prNum]);
        });
      });
      // Sort by date
      allMetrics.sort((a, b) => new Date(a.prMergedAt).getTime() - new Date(b.prMergedAt).getTime());
      metrics.value = allMetrics;
    }
    loading.value = false;
  });
});

const avgCycleTime = computed(() => {
  if (metrics.value.length === 0) return 0;
  return (metrics.value.reduce((acc, m) => acc + m.cycleTimeHours, 0) / metrics.value.length).toFixed(1);
});

const avgPRLeadTime = computed(() => {
  if (metrics.value.length === 0) return 0;
  return (metrics.value.reduce((acc, m) => acc + m.prLeadTimeHours, 0) / metrics.value.length).toFixed(1);
});

const lineChartData = computed(() => ({
  labels: metrics.value.map(m => format(new Date(m.prMergedAt), 'MMM dd')),
  datasets: [
    {
      label: 'Cycle Time (h)',
      borderColor: '#42b883',
      data: metrics.value.map(m => m.cycleTimeHours),
      tension: 0.1
    },
    {
      label: 'PR Lead Time (h)',
      borderColor: '#35495e',
      data: metrics.value.map(m => m.prLeadTimeHours),
      tension: 0.1
    }
  ]
}));

const scatterChartData = computed(() => ({
  datasets: [
    {
      label: 'PRs',
      backgroundColor: '#42b883',
      data: metrics.value.map(m => ({
        x: new Date(m.prMergedAt).getTime(),
        y: m.cycleTimeHours,
        title: m.title
      }))
    }
  ]
}));

const scatterOptions: any = {
  scales: {
    x: {
      type: 'time',
      time: {
        unit: 'day'
      }
    },
    y: {
      title: {
        display: true,
        text: 'Hours'
      }
    }
  },
  plugins: {
    tooltip: {
      callbacks: {
        label: (context: any) => {
          const item = context.raw;
          return `${item.title}: ${item.y}h`;
        }
      }
    }
  }
};
</script>

<template>
  <div class="dashboard">
    <header>
      <h1>🚀 Dev Metrics Dashboard</h1>
      <div v-if="!loading" class="stats">
        <div class="stat-card">
          <h3>Avg Cycle Time</h3>
          <p>{{ avgCycleTime }} hrs</p>
        </div>
        <div class="stat-card">
          <h3>Avg PR Lead Time</h3>
          <p>{{ avgPRLeadTime }} hrs</p>
        </div>
      </div>
    </header>

    <main v-if="!loading && metrics.length > 0">
      <div class="chart-container">
        <h2>Trends Over Time</h2>
        <Line :data="lineChartData" />
      </div>

      <div class="chart-container">
        <h2>Cycle Time Distribution</h2>
        <Scatter :data="scatterChartData" :options="scatterOptions" />
      </div>

      <div class="table-container">
        <h2>Recent Merges</h2>
        <table>
          <thead>
            <tr>
              <th>PR</th>
              <th>Jira</th>
              <th>Cycle Time</th>
              <th>PR Lead Time</th>
              <th>Merged At</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in metrics.slice().reverse()" :key="m.prNumber">
              <td>#{{ m.prNumber }} - {{ m.title }}</td>
              <td>{{ m.jiraId }}</td>
              <td>{{ m.cycleTimeHours }}h</td>
              <td>{{ m.prLeadTimeHours }}h</td>
              <td>{{ format(new Date(m.prMergedAt), 'yyyy-MM-dd HH:mm') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
    <div v-else-if="loading" class="loader">Loading metrics...</div>
    <div v-else-if="!db" class="error-state">
       <h2>Missing Firebase Configuration</h2>
       <p>Please provide <code>VITE_FIREBASE_CONFIG</code> and <code>VITE_FIREBASE_DATABASE_URL</code> environment variables.</p>
    </div>
    <div v-else class="empty-state">
       <h2>No Metrics Data Yet</h2>
       <p>Once your PRs are merged, they will appear here. You can also run the historical scraper.</p>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
  font-family: sans-serif;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
  flex-wrap: wrap;
  gap: 1rem;
}

header h1 {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.stats {
  display: flex;
  gap: 1rem;
}

.stat-card {
  background: #f8f9fa;
  padding: 1rem 2rem;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  text-align: center;
}

.stat-card h3 {
  margin: 0;
  font-size: 0.9rem;
  color: #666;
}

.stat-card p {
  margin: 0.5rem 0 0;
  font-size: 1.5rem;
  font-weight: bold;
  color: #42b883;
}

.chart-container {
  background: white;
  padding: 1.5rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
  margin-bottom: 2rem;
}

.table-container {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 1rem;
}

th, td {
  padding: 0.75rem;
  text-align: left;
  border-bottom: 1px solid #eee;
}

th {
  background: #fcfcfc;
  color: #666;
}

.loader {
  text-align: center;
  padding: 5rem;
  font-size: 1.2rem;
  color: #999;
}
</style>
