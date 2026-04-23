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
  branchStartedAt?: string;
  branchLeadTimeHours?: number;
  prMergedAt: string;
  repoName?: string;
}

const metrics = ref<Metric[]>([]);
const loading = ref(true);
const selectedRepo = ref<string>('all');
const availableRepos = ref<string[]>([]);

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
      const repos = Object.keys(data);
      availableRepos.value = repos;
      Object.keys(data).forEach(repo => {
        Object.keys(data[repo]).forEach(prNum => {
          allMetrics.push({ ...data[repo][prNum], repoName: repo });
        });
      });
      // Sort by date
      allMetrics.sort((a, b) => new Date(a.prMergedAt).getTime() - new Date(b.prMergedAt).getTime());
      metrics.value = allMetrics;
    }
    loading.value = false;
  });
});

const filteredMetrics = computed(() => {
  if (selectedRepo.value === 'all') return metrics.value;
  return metrics.value.filter(m => m.repoName === selectedRepo.value);
});

const avgCycleTime = computed(() => {
  const withCycleTime = filteredMetrics.value.filter(m => m.cycleTimeHours !== null);
  if (withCycleTime.length === 0) return 'N/A';
  return (withCycleTime.reduce((acc, m) => acc + m.cycleTimeHours, 0) / withCycleTime.length).toFixed(1);
});

const avgPRLeadTime = computed(() => {
  if (filteredMetrics.value.length === 0) return 0;
  return (filteredMetrics.value.reduce((acc, m) => acc + m.prLeadTimeHours, 0) / filteredMetrics.value.length).toFixed(1);
});

const avgBranchLeadTime = computed(() => {
  const withBranchLeadTime = filteredMetrics.value.filter(m => m.branchLeadTimeHours != null);
  if (withBranchLeadTime.length === 0) return 'N/A';
  return (withBranchLeadTime.reduce((acc, m) => acc + (m.branchLeadTimeHours as number), 0) / withBranchLeadTime.length).toFixed(1);
});

const lineChartData = computed(() => ({
  labels: filteredMetrics.value.map(m => format(new Date(m.prMergedAt), 'MMM dd')),
  datasets: [
    {
      label: 'Cycle Time (h)',
      borderColor: '#42b883',
      data: filteredMetrics.value.map(m => m.cycleTimeHours),
      tension: 0.1
    },
    {
      label: 'PR Lead Time (h)',
      borderColor: '#35495e',
      data: filteredMetrics.value.map(m => m.prLeadTimeHours),
      tension: 0.1
    },
    {
      label: 'Branch Lead Time (h)',
      borderColor: '#e74c3c',
      data: filteredMetrics.value.map(m => m.branchLeadTimeHours ?? null),
      tension: 0.1
    }
  ]
}));

const scatterChartData = computed(() => ({
  datasets: [
    {
      label: 'PRs',
      backgroundColor: '#42b883',
      data: filteredMetrics.value
        .filter(m => m.cycleTimeHours !== null)
        .map(m => ({
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
      <div v-if="!loading && availableRepos.length > 0" class="controls">
        <label for="repo-select">Project:</label>
        <select id="repo-select" v-model="selectedRepo">
          <option value="all">All Projects (Aggregated)</option>
          <option v-for="repo in availableRepos" :key="repo" :value="repo">
            {{ repo.replace(/:/g, '/').replace(/_/g, '.') }}
          </option>
        </select>
      </div>
      <div v-if="!loading" class="stats">
        <div class="stat-card">
          <h3>Avg Cycle Time</h3>
          <p>{{ avgCycleTime }} hrs</p>
        </div>
        <div class="stat-card">
          <h3>Avg PR Lead Time</h3>
          <p>{{ avgPRLeadTime }} hrs</p>
        </div>
        <div class="stat-card">
          <h3>Avg Branch Lead Time</h3>
          <p>{{ avgBranchLeadTime }} hrs</p>
        </div>
      </div>
    </header>

    <main v-if="!loading && filteredMetrics.length > 0">
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
              <th>Branch Lead Time</th>
              <th>Merged At</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in filteredMetrics.slice().reverse()" :key="m.prNumber">
              <td>#{{ m.prNumber }} - {{ m.title }} <br/><small v-if="selectedRepo === 'all'">{{ m.repoName }}</small></td>
              <td>{{ m.jiraId ?? '—' }}</td>
              <td>{{ m.cycleTimeHours !== null ? m.cycleTimeHours + 'h' : '—' }}</td>
              <td>{{ m.prLeadTimeHours }}h</td>
              <td>{{ m.branchLeadTimeHours != null ? m.branchLeadTimeHours + 'h' : '—' }}</td>
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

.controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.controls select {
  padding: 0.5rem;
  border-radius: 4px;
  border: 1px solid #ddd;
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
