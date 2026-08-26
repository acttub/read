import Link from "next/link";
import { Page } from "../../components/Page";

/**
 * 전송·저장 사실 고지.
 *
 * ⚠️ 이 페이지의 본문이 곧 "무엇이 어디로 나가는가"다. 전송 경로나 저장 위치를 바꾸면
 * 여기를 같이 고친다 — 코드와 어긋나는 순간 거짓 고지가 된다.
 * 지금 적혀 있는 경로: /api/parse-roles(OpenAI, 국외) · /api/transcribe(OpenAI, 국외) ·
 * speechSynthesis(기기 안 또는 브라우저 음성 서비스) · SpeechRecognition(브라우저 제공사) ·
 * HuggingFace CDN(음성 모델 내려받기) · 집계 시트.
 */

export const metadata = {
  title: "대본은 어디로 가나요 · acttub",
};

const B = ({ children }: { children: React.ReactNode }) => (
  <strong className="text-ink">{children}</strong>
);

const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a className="text-blue underline" href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

export default function PrivacyPage() {
  return (
    <Page>
      <article className="px-5 py-8 md:px-0 md:py-0 text-[14px] leading-[1.75] text-ink-sub">
        <p className="text-[13px] font-bold text-blue">acttub</p>
        <h1 className="mt-1 text-[24px] font-black text-ink">대본은 어디로 가나요</h1>
        <p className="mt-2 text-[15px]">
          대본과 마이크가 어디까지 가고, 무엇을 남기고 무엇을 남기지 않는지 그대로 적었습니다.
        </p>

        <section className="mt-7 rounded-[18px] border border-line bg-surface p-5">
          <p>
            <B>한 줄로:</B> 넣은 대본은 <B>이 기기의 세션 저장소</B>에 보관하고 acttub 서버에는 저장하지
            않습니다. 다만 대본을 넣으면 배역 이름을 찾기 위해 <B>대본이 OpenAI로 전송</B>되고, 암기를
            말로 맞춰보는 순간에는 <B>말소리가 전송</B>됩니다.
          </p>
        </section>

        <Section title="무엇을 받나요">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              붙여넣거나 파일로 넣은 <B>대본 본문</B> (txt · pdf · hwp · docx — 파일은 이 기기에서
              열립니다)
            </li>
            <li>내 배역, 연습 방식, 넘김 방식 같은 <B>설정값</B></li>
            <li>넘김 방식이 침묵 감지일 때와 암기를 말로 맞춰볼 때 쓰는 <B>마이크 입력</B></li>
            <li>어느 화면까지 갔는지 같은 <B>익명 행동 기록</B></li>
          </ul>
          <p className="mt-3">이름·연락처·계정 정보는 받지 않습니다. 로그인도 없습니다.</p>
        </Section>

        <Section title="대본과 설정은 어디에 저장되나요">
          <p>
            브라우저의 세션 저장소까지입니다. <B>탭을 닫으면 사라집니다.</B> acttub 서버·데이터베이스·기록
            어디에도 대본 본문을 저장하지 않습니다.
          </p>
          <p className="mt-3">
            넣는 대본은 대개 다른 사람의 저작물입니다. 파일도 이 기기의 브라우저 안에서 열어 글자를
            읽습니다.
          </p>
        </Section>

        <Section title="배역 이름을 찾을 때는 대본이 나갑니다">
          <p>
            대본을 넣으면 <B>앞 100,000자</B>가 acttub 서버를 거쳐 <B>OpenAI</B>로 전송돼 배역 이름
            목록으로 바뀝니다. OpenAI의 서버는 <B>대한민국 밖에 있습니다</B> — 즉 대본이 국외로
            이전됩니다. 거쳐 가는 acttub 서버는 대본과 응답을 저장하지 않고 기록에도 남기지 않습니다 —
            응답 상태까지만 남습니다.
          </p>
          <p className="mt-3">
            받은 이름은 원문에서 실제로 말하는 배역인지 기기 안에서 확인하고, 대사를 나누는 일은 기기
            안에서 합니다. 전송이 실패하거나 쓸 만한 이름이 오지 않으면 <B>기기 안에서 찾은 결과를 그대로
            씁니다.</B> 전송된 대본을 OpenAI가 어떻게 다루는지는{" "}
            <A href="https://openai.com/policies/privacy-policy">OpenAI 개인정보 처리방침</A>을 따릅니다.
          </p>
        </Section>

        <Section title="읽어줄 때 — 고른 음성에 따라 갈립니다">
          <p>저장하지 않는 것과 전송하지 않는 것은 다릅니다. 어느 음성을 쓰는지에 따라 갈립니다.</p>
          <ul className="mt-3 list-disc space-y-2.5 pl-5">
            <li>
              <B>기기 음성 (기본값)</B> — 기기 안에서 도는 음성을 먼저 씁니다. 그 경우 대사가 기기 밖으로
              나가지 않습니다. <B>다만 기기 안에 쓸 수 있는 한국어 음성이 없으면</B> 브라우저의 음성
              서비스로 대사가 전달됩니다 — 그런 기기에서는 목소리를 준비하는 화면에서 그 사실을
              알려드립니다.
            </li>
            <li>
              <B>브라우저 안에서 도는 음성 (직접 받는 음성)</B> — 눌러서 받기로 한 경우에만 씁니다. 이
              음성은 <B>대사를 기기 밖으로 보내지 않습니다.</B> 대신 <B>음성 모델 파일을 내려받습니다</B> —
              기기에 따라 약 138MB 또는 380MB이고, 파일은{" "}
              <A href="https://huggingface.co">HuggingFace</A>의 배포 서버에서 받습니다. 이때 나가는 것은
              파일 요청이지 대사가 아닙니다. 받은 모델은 <B>브라우저 저장 공간에 남습니다</B> — 다음에 또
              받지 않기 위해서이고, 브라우저에서 이 사이트의 저장 데이터를 지우면 함께 지워집니다.
            </li>
          </ul>
          <p className="mt-3">
            어느 쪽이든 <B>내 배역의 대사와 지문은 읽지 않습니다.</B> 상대 배역의 대사만 소리가 됩니다.
          </p>
        </Section>

        <Section title="암기를 맞춰볼 때는 말소리가 나갑니다">
          <p>암기 대조에는 방식이 두 개 있고, 마이크를 쓰는지가 다릅니다.</p>
          <ul className="mt-3 list-disc space-y-2.5 pl-5">
            <li>
              <B>음성 모드</B> — 말한 것을 잠깐 녹음해 acttub 서버를 거쳐 <B>OpenAI의 음성 변환</B>으로
              보내고, 글자로 바꿔 대본과 맞춰봅니다. OpenAI의 서버는 <B>대한민국 밖에 있습니다.</B> 거쳐
              가는 acttub 서버는 녹음도 변환된 글자도 <B>저장하지 않고 기록에도 남기지 않습니다</B> — 응답
              상태까지만 남습니다. 이 변환을 쓸 수 없으면 <B>브라우저의 음성 인식으로 이어가며</B>, 그때는
              말소리가 브라우저 제공사의 서버로 전송된다고 화면에 알립니다. 그것도 안 되면 마이크를 쓰지
              않는 방식으로 넘어갑니다. 글자로 바뀐 결과는 <B>맞춰본 뒤 바로 버립니다.</B>
            </li>
            <li>
              <B>무음 모드</B> — <B>마이크를 아예 켜지 않습니다.</B> 입력하거나 넘어가기로 마지막 줄까지
              진행할 수 있고, 아무것도 기기 밖으로 나가지 않습니다.
            </li>
          </ul>
          <p className="mt-3">
            맞춰보는 것은 <B>글자</B>입니다 — 말한 것을 글자로 바꿔 대본 글자와 비교합니다. 소리 자체는
            저장하지 않습니다.
          </p>
        </Section>

        <Section title="마이크는 어디까지 쓰나요">
          <p>
            내 차례가 끝났는지 알아내는 데와 암기 대조에만 씁니다. <B>녹음을 저장하지 않고</B>, 줄이
            바뀌거나 연습을 나가면 마이크를 실제로 끕니다.
          </p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>
              <B>침묵 감지 (기본값)</B> — 말이 끝난 뒤 조용해지는 것을 <B>음량으로만</B> 알아냅니다. 무슨
              말을 했는지는 알지 못하고 <B>소리가 기기 밖으로 나가지 않습니다.</B>
            </li>
            <li>
              <B>버튼으로 넘기기</B> — 직접 눌러 넘깁니다. <B>마이크를 아예 쓰지 않습니다.</B>
            </li>
          </ul>
        </Section>

        <Section title="무엇을 남기나요">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <B>남깁니다</B> — 어느 화면까지 갔는지 같은 <B>익명 집계 기록</B>. 한 번의 방문에서 항목별로
              한 번만 보냅니다. 누가 했는지는 알 수 없습니다.
            </li>
            <li>
              <B>남기지 않습니다</B> — 대본 본문, 마이크 입력, 만들어진 음성, 기기를 식별하는 값.
            </li>
          </ul>
          <p className="mt-3">
            집계 기록은 이 도구를 계속 만들지 판단하는 데만 씁니다. 광고에 팔지 않습니다.
          </p>
        </Section>

        <Section title="대본의 권리">
          <p>
            넣는 대본의 권리는 저작권자에게 있습니다. 이 도구는{" "}
            <B>본인이 쓸 수 있는 범위의 대본을 혼자 연습하는 용도</B>입니다. 대본을 공개하거나 남에게 보내는
            기능은 없고, 우리가 대본을 모으지도 않습니다.
          </p>
        </Section>

        <Section title="아무것도 내보내고 싶지 않다면">
          <p>
            <B>대본을 넣는 단계</B>에서는 배역 이름을 찾기 위해 대본이 OpenAI로 전송되므로, 대본을 기기
            밖으로 아예 보내지 않는 사용 경로는 없습니다.
          </p>
          <p className="mt-3">
            <B>읽어주기</B>는 <B>기기 음성 + 침묵 감지</B>를 쓰면 읽을 대사와 말소리가 기기 밖으로 나가지
            않습니다. 둘 다 기본값이라 그대로 두면 됩니다. 단 기기 안에 쓸 수 있는 한국어 음성이 없는
            기기는 예외이고, 그럴 때는 화면에서 알려드립니다.
          </p>
          <p className="mt-3">
            <B>암기</B>는 <B>무음 모드</B>로 하면 마이크를 쓰지 않고 아무것도 기기 밖으로 나가지 않습니다.
            읽어주기에서 마이크조차 켜고 싶지 않다면 넘김 방식을 <B>버튼</B>으로 바꾸세요.
          </p>
        </Section>

        <Section title="문의">
          <p>
            인스타그램 <A href="https://instagram.com/acttub_com">@acttub_com</A>으로 알려주세요.
          </p>
        </Section>

        <p className="mt-10 text-[12px] leading-relaxed text-ink-4">
          최종 수정 2026-08-26
          <br />이 문서는 법률 검토를 받기 전의 <B>사실 고지</B>입니다. 자문 결과에 따라 문구가 바뀔 수
          있습니다.
        </p>
        <Link className="mt-3 inline-flex min-h-11 items-center font-bold text-blue" href="/">
          ← 대본 넣기로 돌아가기
        </Link>
      </article>
    </Page>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-[17px] font-black text-ink">{title}</h2>
      {children}
    </section>
  );
}
