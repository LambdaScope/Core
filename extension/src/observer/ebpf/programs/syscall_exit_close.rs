pub const SOURCE: &str = r#"
#include <linux/bpf.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

struct close_event {
    __u32 pid;
    __u32 fd;
    __u64 timestamp_ns;
};

struct {
    __uint(type, BPF_MAP_TYPE_PERF_EVENT_ARRAY);
    __uint(key_size, sizeof(__u32));
    __uint(value_size, sizeof(__u32));
} close_events SEC(".maps");

SEC("tracepoint/syscalls/sys_exit_close")
int trace_close(struct trace_event_raw_sys_exit *ctx) {
    struct close_event event = {};
    
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.timestamp_ns = bpf_ktime_get_ns();
    
    bpf_perf_event_output(ctx, &close_events, BPF_F_CURRENT_CPU,
                          &event, sizeof(event));
    return 0;
}

char LICENSE[] SEC("license") = "GPL";
"#;
