[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://127.0.0.1:5080',
    [Parameter(Mandatory = $true)][string]$AdminPassword,
    [string]$MemberPassword,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')
if ([string]::IsNullOrWhiteSpace($MemberPassword)) { $MemberPassword = $AdminPassword }
$utf8 = [Text.UTF8Encoding]::new($false)

function Invoke-DemoApi {
    param([string]$Method, [string]$Path, $Body, [string]$Token = $script:AdminToken)
    $arguments = @{ Uri = "$BaseUrl/api/v1$Path"; Method = $Method; TimeoutSec = 30 }
    if ($Token) { $arguments.Headers = @{ Authorization = "Bearer $Token" } }
    if ($null -ne $Body) {
        $arguments.ContentType = 'application/json; charset=utf-8'
        $arguments.Body = $utf8.GetBytes(($Body | ConvertTo-Json -Depth 30 -Compress))
    }
    Invoke-RestMethod @arguments
}

function Set-DemoSettings {
    param([string]$Group, [hashtable]$Values)
    $current = Invoke-DemoApi GET "/admin/settings/$Group"
    $null = Invoke-DemoApi PUT "/admin/settings/$Group" @{ version = $current.version; values = $Values }
}

function Ensure-DemoUser {
    param([string]$Username, [string]$DisplayName, [string]$Role)
    $existing = @((Invoke-DemoApi GET "/admin/users?q=$Username&pageSize=100").items | Where-Object username -eq $Username)
    if ($existing.Count -gt 0) { return $existing[0] }
    Invoke-DemoApi POST '/admin/users' @{ username = $Username; displayName = $DisplayName; password = $MemberPassword; roles = @($Role) }
}

function Ensure-DemoMember {
    param([hashtable]$Member, [string]$UserId)
    $existing = @((Invoke-DemoApi GET '/admin/class/members?pageSize=100').items | Where-Object displayName -eq $Member.displayName)
    $record = if ($existing.Count -gt 0) { $existing[0] } else { Invoke-DemoApi POST '/admin/class/members' $Member }
    if ($UserId -and $record.linkedUserId -ne $UserId) {
        $record = Invoke-DemoApi POST "/admin/class/members/$($record.id)/link-user" @{ userId = $UserId; version = $record.version }
    }
    $record
}

function Ensure-DemoMeeting {
    param([string]$Title, [string]$Description, [datetime]$Date, [bool]$Open)
    $existing = @((Invoke-DemoApi GET '/admin/speech/sessions?pageSize=100').items | Where-Object title -eq $Title)
    $session = if ($existing.Count -gt 0) { $existing[0] } else {
        Invoke-DemoApi POST '/admin/speech/sessions' @{
            title = $Title; description = $Description; date = $Date.ToString('yyyy-MM-dd')
            slotMinutes = 5; allowTeams = $true; maxTeamSize = 4; submissionsOpen = $true
        }
    }
    if ($Open -and $session.status -eq 'draft') {
        $session = Invoke-DemoApi POST "/admin/speech/sessions/$($session.id)/status" @{ status = 'open' }
    }
    $session
}

function Ensure-DemoEntry {
    param([string]$SessionId, [string]$OwnerId, [string]$Topic)
    $existing = @((Invoke-DemoApi GET "/speech/sessions/$SessionId").entries | Where-Object { $_.owner.id -eq $OwnerId })
    if ($existing.Count -gt 0) { return $existing[0] }
    Invoke-DemoApi POST "/admin/speech/sessions/$SessionId/entries" @{ ownerId = $OwnerId; topic = $Topic }
}

function Add-DemoCourseware {
    param($Entry, [string]$Title)
    if ($Entry.PSObject.Properties.Name -contains 'courseware' -and $Entry.courseware) { return $Entry.courseware }
    $safeTitle = [System.Net.WebUtility]::HtmlEncode($Title)
    $html = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'demo/courseware.html') -Raw -Encoding UTF8).Replace('{{TITLE}}', $safeTitle)
    $memory = [IO.MemoryStream]::new()
    $archive = [IO.Compression.ZipArchive]::new($memory, [IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        $resource = $archive.CreateEntry('index.html')
        $writer = [IO.StreamWriter]::new($resource.Open(), $utf8)
        try { $writer.Write($html) } finally { $writer.Dispose() }
    } finally { $archive.Dispose() }
    $client = [Net.Http.HttpClient]::new()
    $form = [Net.Http.MultipartFormDataContent]::new()
    try {
        $client.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $script:AdminToken)
        $file = [Net.Http.ByteArrayContent]::new($memory.ToArray())
        $file.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new('application/zip')
        $form.Add($file, 'file', 'class-meeting-demo.zip')
        $response = $client.PostAsync("$BaseUrl/api/v1/speech/entries/$($Entry.id)/courseware", $form).GetAwaiter().GetResult()
        try {
            $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            if (-not $response.IsSuccessStatusCode) { throw "Courseware upload failed ($([int]$response.StatusCode)): $body" }
            $body | ConvertFrom-Json
        } finally { $response.Dispose() }
    } finally { $form.Dispose(); $client.Dispose(); $memory.Dispose() }
}

$login = Invoke-DemoApi POST '/auth/login' @{ account = 'admin'; password = $AdminPassword } -Token ''
$script:AdminToken = $login.accessToken
$today = (Get-Date).Date
$monday = $today.AddDays(-(([int]$today.DayOfWeek + 6) % 7))
$termStart = $monday.AddDays(-56)
$founded = [datetime]::new($(if ($today.Month -lt 9) { $today.Year - 1 } else { $today.Year }), 9, 1)

foreach ($item in @(
    @{ id = 'meetings'; enabled = $true }, @{ id = 'timetable'; enabled = $true },
    @{ id = 'member-identity'; enabled = $true }, @{ id = 'captcha'; enabled = $false }
)) { $null = Invoke-DemoApi PUT "/admin/plugins/$($item.id)" @{ enabled = $item.enabled } }

Set-DemoSettings site @{ className = '星辰一班'; classNameEn = 'Starlight Class'; slogan = '把每一次相遇，写成共同的故事。' }
Set-DemoSettings appearance @{ particleQualityDefault = 'medium'; particleColor = '#203c36'; accentColor = '#166f58' }
Set-DemoSettings security @{ registrationMode = 'invite'; classInfoPublic = $true; minPasswordLength = 12; sessionHours = 72 }
$profile = Invoke-DemoApi GET '/class/profile'
$null = Invoke-DemoApi PUT '/admin/class/profile' @{
    name = '星辰一班'; nameEn = 'Starlight Class'; motto = '向光而行，各有光芒'
    intro = "我们是星辰一班。这里记录学习、分享和共同成长的片段。`n`n这是 Classight 的独立演示环境，成员与内容均为虚构示例。"
    foundedOn = $founded.ToString('yyyy-MM-dd'); coverUrl = $null; version = $profile.version
}

$teacher = Ensure-DemoUser teacher '陈老师' Admin
$student = Ensure-DemoUser student '林同学' Member
$teacherLogin = Invoke-DemoApi POST '/auth/login' @{ account = 'teacher'; password = $MemberPassword } -Token ''
$studentLogin = Invoke-DemoApi POST '/auth/login' @{ account = 'student'; password = $MemberPassword } -Token ''
$members = @(
    @{ displayName = '陈老师'; title = '班主任'; role = 'teacher'; intro = '陪伴大家探索、提问与成长。'; userId = $teacher.id },
    @{ displayName = '林同学'; title = '学习委员'; role = 'student'; intro = '喜欢阅读与科学，负责本周读书分享。'; userId = $student.id },
    @{ displayName = '周予安'; title = '班长'; role = 'student'; intro = '把每一份想法变成一起行动的计划。' },
    @{ displayName = '许知夏'; title = '课代表'; role = 'student'; intro = '热爱数学，也喜欢记录生活中的小发现。' },
    @{ displayName = '沈星遥'; title = '文艺委员'; role = 'student'; intro = '用音乐和画笔收藏班级里的闪光时刻。' },
    @{ displayName = '顾言'; title = '体育委员'; role = 'student'; intro = '球场上认真拼搏，学习中保持好奇。' },
    @{ displayName = '苏念'; title = '宣传委员'; role = 'student'; intro = '用照片与文字记录大家的共同故事。' },
    @{ displayName = '陆景行'; title = '同学'; role = 'student'; intro = '喜欢编程和动手制作，期待与你交流。' },
    @{ displayName = '温以宁'; title = '同学'; role = 'student'; intro = '对自然保持好奇，正在做一份植物观察笔记。' },
    @{ displayName = '江澈'; title = '同学'; role = 'student'; intro = '每周完成一件小事，让进步看得见。' },
    @{ displayName = '夏禾'; title = '同学'; role = 'student'; intro = '享受小组合作，也喜欢安静读一本书。' },
    @{ displayName = '唐可'; title = '同学'; role = 'student'; intro = '把有趣的问题带进课堂，把答案带进生活。' }
)
foreach ($member in $members) {
    $body = @{ displayName = $member.displayName; title = $member.title; role = $member.role; intro = $member.intro; joinedOn = $founded.ToString('yyyy-MM-dd') }
    $null = Ensure-DemoMember $body $member.userId
}

$events = @(
    @{ title = '初见星辰，向光出发'; days = -45; summary = '第一次班级见面会，我们写下了对新学期的期待。'; tags = @('新学期', '班级记忆'); body = "# 初见星辰，向光出发`n`n在自我介绍与小组交流中，我们从陌生变得熟悉。大家共同选出班级口号：向光而行，各有光芒。" },
    @{ title = '把好奇带进科学课堂'; days = -21; summary = '一次跨学科小组探索：用观察、实验与表达回答真实问题。'; tags = @('学习', '小组合作'); body = "# 把好奇带进科学课堂`n`n同学们分工记录、整理资料、设计演示，用自己的方式分享发现。比找到答案更重要的，是学会一起提问。" },
    @{ title = '秋日运动会，一起奔跑'; days = -7; summary = '接力、呐喊与互相鼓励，组成了这个秋天的共同记忆。'; tags = @('运动会', '班级活动'); body = "# 秋日运动会，一起奔跑`n`n有人站上赛道，有人记录成绩，也有人为伙伴加油。每个人都在自己的位置上，为班级贡献了一份力量。" }
)
$existingEvents = @((Invoke-DemoApi GET '/class/timeline?pageSize=100').items)
foreach ($event in $events) {
    if (@($existingEvents | Where-Object title -eq $event.title).Count -eq 0) {
        $null = Invoke-DemoApi POST '/admin/class/timeline' @{
            title = $event.title; summary = $event.summary; occurredOn = $today.AddDays($event.days).ToString('yyyy-MM-dd')
            tags = $event.tags; body = $event.body; media = @(); coverUrl = $null
        }
    }
}

$periods = @(
    @{ start = '08:00'; end = '08:45' }, @{ start = '08:55'; end = '09:40' },
    @{ start = '10:00'; end = '10:45' }, @{ start = '10:55'; end = '11:40' },
    @{ start = '14:00'; end = '14:45' }, @{ start = '14:55'; end = '15:40' },
    @{ start = '16:00'; end = '16:45' }, @{ start = '16:55'; end = '17:40' }
)
$subjects = @(
    @('语文', '数学', '英语', '体育'), @('数学', '物理', '历史', '美术'),
    @('英语', '语文', '信息技术', '社团活动'), @('数学', '英语', '地理', '音乐'),
    @('语文', '化学', '体育', '班会')
)
$teachers = @{ '语文' = '陈老师'; '数学' = '赵老师'; '英语' = '刘老师'; '物理' = '方老师'; '历史' = '吴老师'; '美术' = '王老师'; '信息技术' = '李老师'; '地理' = '许老师'; '音乐' = '周老师'; '化学' = '孙老师'; '体育' = '张老师'; '班会' = '陈老师'; '社团活动' = '社团指导老师' }
$lessons = @()
for ($day = 1; $day -le 5; $day++) {
    for ($block = 0; $block -lt 4; $block++) {
        $name = $subjects[$day - 1][$block]
        $room = switch ($name) { '体育' { '操场' } '信息技术' { '机房 2' } '美术' { '美术教室' } '音乐' { '音乐教室' } '社团活动' { '活动中心' } default { '教学楼 301' } }
        $lessons += @{
            id = [guid]::NewGuid().ToString(); name = $name; teacher = $teachers[$name]; room = $room; day = $day
            startPeriod = 1 + $block * 2; endPeriod = 2 + $block * 2; startWeek = 1; endWeek = 20; weeks = 'all'
        }
    }
}
$currentTimetable = Invoke-DemoApi GET '/timetable'
$timetable = Invoke-DemoApi PUT '/timetable' @{
    term = "$($termStart.Year) 学年 · 星辰一班演示课表"; startDate = $termStart.ToString('yyyy-MM-dd'); totalWeeks = 20
    periods = $periods; lessons = $lessons; version = $currentTimetable.version
}

$sharing = Ensure-DemoMeeting '成长分享会 · 把好奇变成行动' '开放中的演示班会：可预览网页课件、调整顺序、开始或结束发言。所有内容均为虚构示例。' $today.AddDays(2) $true
$entry = Ensure-DemoEntry $sharing.id $student.id '我的一周学习计划'
$courseware = Add-DemoCourseware $entry '我的一周学习计划'
$null = Ensure-DemoEntry $sharing.id $teacher.id '给未来的自己写一封信'
$null = Ensure-DemoEntry $sharing.id $login.user.id '让班级里的每一份声音被听见'
$signup = Ensure-DemoMeeting '下周班会 · 分享你的新发现' '这是一场保留空队列的演示班会。使用 student 账号报名，尝试组队和上传自己的课件。' $today.AddDays(7) $true
$draft = Ensure-DemoMeeting '班会草稿 · 一起设计我们的下一次活动' '仅班会管理员可见。可演示编辑场次、调整每人时长与开放报名。' $today.AddDays(14) $false
$invites = @((Invoke-DemoApi GET '/admin/invites?pageSize=100').items)
if (@($invites | Where-Object code -eq 'CLASSIGHT-DEMO-2026').Count -eq 0) {
    $null = Invoke-DemoApi POST '/admin/invites' @{ code = 'CLASSIGHT-DEMO-2026'; role = 'Member'; maxUses = 100 }
}

$ticket = Invoke-DemoApi POST "/speech/courseware/$($courseware.id)/preview-ticket"
$preview = Invoke-WebRequest -Uri "$BaseUrl$($ticket.url)" -TimeoutSec 15
if ($preview.StatusCode -ne 200 -or $preview.Content -notmatch '我的一周学习计划') { throw 'Demo courseware preview verification failed.' }
$memberPermissions = Invoke-DemoApi GET '/member-identity/permissions' -Token $studentLogin.accessToken
if ('speech.participate' -notin $memberPermissions.permissions) { throw 'Student permission verification failed.' }
$null = Invoke-DemoApi GET '/auth/me' -Token $teacherLogin.accessToken
$null = Invoke-WebRequest -Uri "$BaseUrl/health/ready" -TimeoutSec 15
$summary = [ordered]@{
    completedAt = [datetimeoffset]::Now.ToString('o')
    accounts = @(@{ username = 'admin'; role = 'SuperAdmin' }, @{ username = 'teacher'; role = 'Admin' }, @{ username = 'student'; role = 'Member' })
    className = '星辰一班'; membersCount = 12; timelineCount = 3; timetableLessons = $timetable.lessons.Count
    termStart = $termStart.ToString('yyyy-MM-dd'); meetingIds = @($sharing.id, $signup.id, $draft.id); coursewareId = $courseware.id
    inviteCode = 'CLASSIGHT-DEMO-2026'; coursewarePreviewVerified = $true
}
if ($OutputDirectory) {
    $dataPath = Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) 'data'
    [IO.Directory]::CreateDirectory($dataPath) | Out-Null
    [IO.File]::WriteAllText((Join-Path $dataPath 'demo-seed.json'), ($summary | ConvertTo-Json -Depth 10), $utf8)
}
$summary | ConvertTo-Json -Depth 10
